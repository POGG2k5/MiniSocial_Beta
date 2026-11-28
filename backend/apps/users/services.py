"""
USER SERVICE - giao diện công khai của phân hệ User (hồ sơ, bạn bè, chặn).
Các phân hệ khác lấy thông tin người dùng qua đây, ví dụ UserService.get_user_summaries().
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q

from apps.authentication import services as auth_services
from common import events
from common.exceptions import NotFound, PermissionDenied, ServiceError
from common.text import sanitize_text

from .models import Block, Friendship, Profile

NONE = "NONE"
PENDING_SENT = "PENDING_SENT"
PENDING_RECEIVED = "PENDING_RECEIVED"
FRIENDS = "FRIENDS"
BLOCKED = "BLOCKED"  # mình chặn họ
BLOCKED_BY = "BLOCKED_BY"  # họ chặn mình


def _users():
    return get_user_model().objects


# ------------------------------------------------------------------ Thông tin tóm tắt
def summarize(user):
    profile = getattr(user, "profile", None)
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "avatar_url": profile.avatar_url if profile else "",
    }


def get_user_summaries(user_ids):
    ids = {str(i) for i in user_ids if i}
    if not ids:
        return {}
    users = _users().filter(id__in=ids).select_related("profile")
    return {str(u.id): summarize(u) for u in users}


def get_user_summary(user_id):
    return get_user_summaries([user_id]).get(str(user_id))


def get_active_user_or_404(user_id):
    user = _users().filter(id=user_id, is_active=True, email_verified=True).select_related("profile").first()
    if not user:
        raise NotFound("Không tìm thấy người dùng")
    return user


# ------------------------------------------------------------------ Hồ sơ (UC-07)
def get_profile(user):
    profile, _ = Profile.objects.get_or_create(user=user)
    return profile


def update_profile(user, data):
    profile = get_profile(user)
    if "full_name" in data:
        name = sanitize_text(data["full_name"], 100)
        if not name:
            raise ServiceError("Họ tên không được để trống")
        user.full_name = name
        user.save(update_fields=["full_name", "search_name"])
    for field, limit in (("bio", 1000), ("location", 100)):
        if field in data:
            setattr(profile, field, sanitize_text(data[field], limit))
    for field in ("avatar_url", "cover_url"):
        if field in data:
            url = (data[field] or "").strip()
            if url and not url.startswith(settings.MEDIA_PUBLIC_BASE_URL):
                raise ServiceError("Ảnh phải được tải lên qua hệ thống", errors={field: ["URL không hợp lệ"]})
            setattr(profile, field, url)
    if "birth_date" in data:
        profile.birth_date = data["birth_date"]
    profile.save()
    return profile


# ------------------------------------------------------------------ Quan hệ
def get_friend_ids(user_id):
    uid = str(user_id)
    rows = Friendship.objects.filter(
        Q(sender_id=uid) | Q(receiver_id=uid), status=Friendship.Status.ACCEPTED
    ).values_list("sender_id", "receiver_id")
    return {str(r if str(s) == uid else s) for s, r in rows}


def get_blocked_ids(user_id):
    """Tập ID có quan hệ chặn với user (mình chặn họ hoặc họ chặn mình)."""
    uid = str(user_id)
    rows = Block.objects.filter(Q(blocker_id=uid) | Q(blocked_id=uid)).values_list("blocker_id", "blocked_id")
    return {str(b if str(a) == uid else a) for a, b in rows}


def is_blocked(a, b):
    return Block.objects.filter(Q(blocker_id=a, blocked_id=b) | Q(blocker_id=b, blocked_id=a)).exists()


def are_friends(a, b):
    return _find_friendship(a, b, Friendship.Status.ACCEPTED) is not None


def _find_friendship(a, b, status=None):
    qs = Friendship.objects.filter(Q(sender_id=a, receiver_id=b) | Q(sender_id=b, receiver_id=a))
    if status:
        qs = qs.filter(status=status)
    return qs.first()


def relationship(viewer_id, target_id):
    viewer_id, target_id = str(viewer_id), str(target_id)
    if viewer_id == target_id:
        return {"status": "SELF", "friendship_id": None}
    if Block.objects.filter(blocker_id=viewer_id, blocked_id=target_id).exists():
        return {"status": BLOCKED, "friendship_id": None}
    if Block.objects.filter(blocker_id=target_id, blocked_id=viewer_id).exists():
        return {"status": BLOCKED_BY, "friendship_id": None}
    f = _find_friendship(viewer_id, target_id)
    if not f:
        return {"status": NONE, "friendship_id": None}
    if f.status == Friendship.Status.ACCEPTED:
        return {"status": FRIENDS, "friendship_id": str(f.id)}
    return {"status": PENDING_SENT if str(f.sender_id) == viewer_id else PENDING_RECEIVED, "friendship_id": str(f.id)}


def _changed(*user_ids):
    events.publish(events.FRIENDSHIP_CHANGED, user_ids=[str(u) for u in user_ids])


# ------------------------------------------------------------------ Kết bạn (UC-09)
@transaction.atomic
def send_friend_request(sender, target_id):
    target = get_active_user_or_404(target_id)
    if str(target.id) == str(sender.id):
        raise ServiceError("Bạn không thể kết bạn với chính mình")
    if is_blocked(sender.id, target.id):
        raise PermissionDenied("Không thể gửi lời mời do quan hệ chặn")
    existing = _find_friendship(sender.id, target.id)
    if existing:
        if existing.status == Friendship.Status.ACCEPTED:
            raise ServiceError("Hai bạn đã là bạn bè", code="ALREADY_FRIENDS")
        if str(existing.sender_id) == str(sender.id):
            raise ServiceError("Bạn đã gửi lời mời trước đó", code="ALREADY_SENT")
        # Đối phương đã gửi lời mời cho mình -> chấp nhận luôn
        return accept_friend_request(sender, existing.id)
    try:
        f = Friendship.objects.create(sender=sender, receiver=target)
    except IntegrityError:
        raise ServiceError("Lời mời đã tồn tại")
    events.publish(
        events.FRIEND_REQUEST_SENT, friendship_id=str(f.id), actor_id=str(sender.id), recipient_id=str(target.id)
    )
    return f


@transaction.atomic
def accept_friend_request(user, friendship_id):
    f = (
        Friendship.objects.select_for_update()
        .filter(id=friendship_id, receiver=user, status=Friendship.Status.PENDING)
        .first()
    )
    if not f:
        raise NotFound("Không tìm thấy lời mời kết bạn")
    f.status = Friendship.Status.ACCEPTED
    f.save(update_fields=["status", "updated_at"])
    events.publish(
        events.FRIEND_ACCEPTED, friendship_id=str(f.id), actor_id=str(user.id), recipient_id=str(f.sender_id)
    )
    _changed(f.sender_id, f.receiver_id)
    return f


def decline_friend_request(user, friendship_id):
    deleted, _ = Friendship.objects.filter(id=friendship_id, receiver=user, status=Friendship.Status.PENDING).delete()
    if not deleted:
        raise NotFound("Không tìm thấy lời mời kết bạn")


def cancel_friend_request(user, friendship_id):
    deleted, _ = Friendship.objects.filter(id=friendship_id, sender=user, status=Friendship.Status.PENDING).delete()
    if not deleted:
        raise NotFound("Không tìm thấy lời mời đã gửi")


def unfriend(user, target_id):
    f = _find_friendship(user.id, target_id, Friendship.Status.ACCEPTED)
    if not f:
        raise NotFound("Hai bạn chưa là bạn bè")
    f.delete()
    _changed(user.id, target_id)


def list_friends(user_id):
    ids = get_friend_ids(user_id)
    return _users().filter(id__in=ids, is_active=True).select_related("profile").order_by("full_name")


def list_requests(user, direction="received"):
    qs = Friendship.objects.filter(status=Friendship.Status.PENDING)
    qs = qs.filter(receiver=user) if direction == "received" else qs.filter(sender=user)
    return qs.select_related("sender__profile", "receiver__profile").order_by("-created_at")


def suggestions(user, limit=10):
    """Gợi ý: ưu tiên bạn của bạn, sau đó người dùng mới; loại bỏ bạn bè, người bị chặn, lời mời đang chờ."""
    friend_ids = get_friend_ids(user.id)
    pending = Friendship.objects.filter(Q(sender=user) | Q(receiver=user)).values_list("sender_id", "receiver_id")
    exclude = friend_ids | get_blocked_ids(user.id) | {str(x) for pair in pending for x in pair} | {str(user.id)}
    fof = set()
    for fid in list(friend_ids)[:50]:
        fof |= get_friend_ids(fid)
    fof -= exclude
    result = list(auth_services.user_queryset().filter(id__in=fof).select_related("profile")[:limit])
    if len(result) < limit:
        more = (
            auth_services.user_queryset()
            .exclude(id__in=exclude | {str(u.id) for u in result})
            .select_related("profile")
            .order_by("-created_at")[: limit - len(result)]
        )
        result += list(more)
    return result


def search(viewer, query, limit=20):
    ids = auth_services.search_user_ids(query, limit=limit + 10)
    blocked = get_blocked_ids(viewer.id)
    ids = [i for i in ids if i not in blocked]
    users = {str(u.id): u for u in _users().filter(id__in=ids).select_related("profile")}
    return [users[i] for i in ids if i in users][:limit]


# ------------------------------------------------------------------ Chặn (UC-10)
@transaction.atomic
def block_user(user, target_id):
    target = _users().filter(id=target_id).first()
    if not target:
        raise NotFound("Không tìm thấy người dùng")
    if str(target.id) == str(user.id):
        raise ServiceError("Bạn không thể chặn chính mình")
    Block.objects.get_or_create(blocker=user, blocked=target)
    Friendship.objects.filter(Q(sender=user, receiver=target) | Q(sender=target, receiver=user)).delete()
    _changed(user.id, target.id)


def unblock_user(user, target_id):
    deleted, _ = Block.objects.filter(blocker=user, blocked_id=target_id).delete()
    if not deleted:
        raise NotFound("Bạn chưa chặn người này")
    _changed(user.id, target_id)


def list_blocked(user):
    ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
    return _users().filter(id__in=list(ids)).select_related("profile")


def mutual_friend_counts(user_id, candidate_ids):
    """
    UPDATE_ADDFRIEND_01: số bạn chung giữa user và từng người trong candidate_ids.
    Một truy vấn duy nhất trên friendships: cạnh ACCEPTED nối một bạn của user với một ứng viên.
    """
    candidates = {str(c) for c in candidate_ids}
    counts = dict.fromkeys(candidates, 0)
    my_friends = get_friend_ids(user_id)
    if not candidates or not my_friends:
        return counts
    rows = (
        Friendship.objects.filter(status=Friendship.Status.ACCEPTED)
        .filter(
            Q(sender_id__in=my_friends, receiver_id__in=candidates)
            | Q(sender_id__in=candidates, receiver_id__in=my_friends)
        )
        .values_list("sender_id", "receiver_id")
    )
    for a, b in rows:
        a, b = str(a), str(b)
        candidate = a if a in candidates else b
        counts[candidate] += 1
    return counts


def summarize_with_mutual(viewer, users):
    users = list(users)
    counts = mutual_friend_counts(viewer.id, [u.id for u in users])
    return [{**summarize(u), "mutual_friends_count": counts.get(str(u.id), 0)} for u in users]


def friends_count(user_id):
    return len(get_friend_ids(user_id))


# ------------------------------------------------------------------ Quản trị (gọi từ phân hệ Admin)
def ban_user(user_id, reason=""):
    user = auth_services.set_user_active(user_id, False)
    events.publish(events.USER_BANNED, user_id=str(user.id), reason=reason)
    return user


def unban_user(user_id):
    return auth_services.set_user_active(user_id, True)
