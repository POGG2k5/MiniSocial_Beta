"""
POST SERVICE - giao diện công khai của phân hệ Post (bài viết, bình luận, thích, chia sẻ, bảng tin).
"""

import json
import logging

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.groups import services as group_services
from apps.media_files import services as media_services
from apps.users import services as user_services
from common import badwords, events
from common.exceptions import NotFound, PermissionDenied, ServiceError
from common.redis_client import get_redis
from common.stats import count_per_day
from common.text import sanitize_text

from .models import Comment, Like, Post, Share

logger = logging.getLogger(__name__)
MAX_CONTENT = 10000


def _is_admin(user):
    return getattr(user, "role", None) == "ADMIN"


# ------------------------------------------------------------------ Quyền xem
def can_view(viewer, post):
    if post.deleted_at:
        return False
    if str(post.author_id) == str(viewer.id) or _is_admin(viewer):
        return True
    if post.is_flagged:
        return False
    if user_services.is_blocked(viewer.id, post.author_id):
        return False
    if post.group_id:
        return group_services.can_view_posts(viewer.id, post.group_id)
    if post.privacy == Post.Privacy.PUBLIC:
        return True
    if post.privacy == Post.Privacy.FRIENDS:
        return user_services.are_friends(viewer.id, post.author_id)
    return False


def get_visible_post(viewer, post_id):
    post = Post.objects.filter(id=post_id).first()
    if not post or not can_view(viewer, post):
        raise NotFound("Bài viết không tồn tại hoặc bạn không có quyền xem")
    return post


# ------------------------------------------------------------------ Serialize theo lô (chống N+1)
def serialize_posts(posts, viewer):
    posts = list(posts)
    if not posts:
        return []
    ids = [p.id for p in posts]
    users = user_services.get_user_summaries({p.author_id for p in posts})
    media = media_services.media_for_posts(ids)
    groups = group_services.get_group_briefs({p.group_id for p in posts if p.group_id})
    liked = {str(i) for i in Like.objects.filter(user=viewer, post_id__in=ids).values_list("post_id", flat=True)}
    out = []
    for p in posts:
        mine = str(p.author_id) == str(viewer.id)
        out.append(
            {
                "id": str(p.id),
                "author": users.get(str(p.author_id)),
                "group": groups.get(str(p.group_id)) if p.group_id else None,
                "content": p.content,
                "privacy": p.privacy,
                "media": media.get(str(p.id), []),
                "likes_count": p.likes_count,
                "comments_count": p.comments_count,
                "shares_count": p.shares_count,
                "is_liked": str(p.id) in liked,
                "is_pinned": p.is_pinned,
                "is_edited": p.is_edited,
                "is_flagged": p.is_flagged if (mine or _is_admin(viewer)) else False,
                "can_edit": mine,
                "can_delete": mine
                or _is_admin(viewer)
                or bool(p.group_id and group_services.can_moderate(viewer.id, p.group_id)),
                "created_at": p.created_at.isoformat(),
                "updated_at": p.updated_at.isoformat(),
            }
        )
    return out


# ------------------------------------------------------------------ UC-11: Đăng bài
@transaction.atomic
def create_post(author, content="", privacy=Post.Privacy.PUBLIC, group_id=None, files=None):
    files = files or []
    content = sanitize_text(content, MAX_CONTENT)
    if not content and not files:
        raise ServiceError("Bài viết phải có nội dung hoặc ít nhất một ảnh/video")
    if privacy not in Post.Privacy.values:
        raise ServiceError("Quyền riêng tư không hợp lệ")
    validated = media_services.validate_many(files) if files else []
    if group_id and not group_services.can_post(author.id, group_id):
        raise PermissionDenied("Bạn cần là thành viên của nhóm để đăng bài")
    flagged_words = badwords.find_badwords(content)
    post = Post.objects.create(
        author=author,
        content=content,
        privacy=Post.Privacy.PUBLIC if group_id else privacy,
        group_id=group_id or None,
        is_flagged=bool(flagged_words),
    )
    if files:
        media_services.attach_post_media(post.id, files, validated)
    events.publish(
        events.POST_CREATED,
        post_id=str(post.id),
        author_id=str(author.id),
        group_id=str(group_id) if group_id else None,
    )
    if flagged_words:
        events.publish(events.POST_FLAGGED, post_id=str(post.id), author_id=str(author.id), words=flagged_words)
    return post


# ------------------------------------------------------------------ UC-12: Sửa / xóa mềm / ghim
def _own_post(user, post_id):
    post = Post.objects.filter(id=post_id, deleted_at__isnull=True).first()
    if not post:
        raise NotFound("Không tìm thấy bài viết")
    if str(post.author_id) != str(user.id):
        raise PermissionDenied("Bạn chỉ có thể chỉnh sửa bài viết của mình")
    return post


def update_post(user, post_id, data):
    post = _own_post(user, post_id)
    if "content" in data:
        content = sanitize_text(data["content"], MAX_CONTENT)
        if not content and not post.media_files.exists():
            raise ServiceError("Nội dung không được để trống")
        flagged_words = badwords.find_badwords(content)
        post.content = content
        if flagged_words and not post.is_flagged:
            post.is_flagged = True
            events.publish(events.POST_FLAGGED, post_id=str(post.id), author_id=str(user.id), words=flagged_words)
    if "privacy" in data and not post.group_id:
        if data["privacy"] not in Post.Privacy.values:
            raise ServiceError("Quyền riêng tư không hợp lệ")
        post.privacy = data["privacy"]
    post.is_edited = True
    post.save()
    _invalidate_author_audience(post.author_id)
    return post


def delete_post(user, post_id):
    post = Post.objects.filter(id=post_id, deleted_at__isnull=True).first()
    if not post:
        raise NotFound("Không tìm thấy bài viết")
    allowed = str(post.author_id) == str(user.id) or _is_admin(user)
    if not allowed and post.group_id:
        allowed = group_services.can_moderate(user.id, post.group_id)
    if not allowed:
        raise PermissionDenied("Bạn không có quyền xóa bài viết này")
    soft_delete_post(post.id)


def toggle_pin(user, post_id):
    post = _own_post(user, post_id)
    post.is_pinned = not post.is_pinned
    post.save(update_fields=["is_pinned", "updated_at"])
    return post


# ------------------------------------------------------------------ UC-13: Bảng tin (Fan-out on Read + Redis cache)
def _feed_key(user_id):
    return f"feed:{user_id}:first"


def invalidate_feed(user_ids):
    keys = [_feed_key(u) for u in user_ids]
    if keys:
        try:
            get_redis().delete(*keys)
        except Exception:  # noqa: BLE001
            logger.warning("Không xóa được feed cache")


def _invalidate_author_audience(author_id):
    invalidate_feed(user_services.get_friend_ids(author_id) | {str(author_id)})


def feed_queryset(user):
    friend_ids = user_services.get_friend_ids(user.id) - user_services.get_blocked_ids(user.id)
    visible = Q(author_id=user.id) | Q(
        author_id__in=friend_ids, privacy__in=[Post.Privacy.PUBLIC, Post.Privacy.FRIENDS], is_flagged=False
    )
    qs = Post.objects.filter(visible, group_id__isnull=True, deleted_at__isnull=True)
    return qs, bool(friend_ids)


def get_cached_first_page(user_id):
    try:
        raw = get_redis().get(_feed_key(user_id))
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


def set_cached_first_page(user_id, ids, next_link):
    try:
        get_redis().set(_feed_key(user_id), json.dumps({"ids": ids, "next": next_link}), ex=settings.FEED_CACHE_TTL)
    except Exception:  # noqa: BLE001
        pass


def posts_by_ids(ids):
    posts = {str(p.id): p for p in Post.objects.filter(id__in=ids, deleted_at__isnull=True)}
    return [posts[i] for i in ids if i in posts]


def profile_queryset(viewer, author_id):
    """
    Dòng thời gian trang cá nhân: lọc theo quyền xem giữa viewer và author.
    Quản trị viên cũng chỉ thấy như người dùng thường; bài vi phạm được xem qua trang báo cáo.
    """
    if str(viewer.id) != str(author_id) and user_services.is_blocked(viewer.id, author_id):
        raise NotFound("Không tìm thấy người dùng")
    qs = Post.objects.filter(author_id=author_id, group_id__isnull=True, deleted_at__isnull=True)
    if str(viewer.id) == str(author_id):
        return qs
    allowed = [Post.Privacy.PUBLIC]
    if user_services.are_friends(viewer.id, author_id):
        allowed.append(Post.Privacy.FRIENDS)
    return qs.filter(privacy__in=allowed, is_flagged=False)


def group_queryset(viewer, group_id):
    """UC-21: bài viết trong nhóm (nhóm kín chỉ thành viên xem được)."""
    if not group_services.can_view_posts(viewer.id, group_id):
        raise PermissionDenied("Hãy tham gia nhóm để xem bài viết")
    blocked = user_services.get_blocked_ids(viewer.id)
    return (
        Post.objects.filter(group_id=group_id, deleted_at__isnull=True)
        .exclude(author_id__in=blocked)
        .filter(Q(is_flagged=False) | Q(author_id=viewer.id))
    )


# ------------------------------------------------------------------ UC-14: Thích
@transaction.atomic
def toggle_like(user, post_id):
    post = get_visible_post(user, post_id)
    deleted, _ = Like.objects.filter(post=post, user=user).delete()
    if deleted:
        Post.objects.filter(id=post.id, likes_count__gt=0).update(likes_count=F("likes_count") - 1)
        liked = False
    else:
        try:
            with transaction.atomic():
                Like.objects.create(post=post, user=user)
        except IntegrityError:  # bấm đúp đồng thời
            pass
        Post.objects.filter(id=post.id).update(likes_count=F("likes_count") + 1)
        liked = True
        if str(post.author_id) != str(user.id):
            events.publish(
                events.POST_LIKED, post_id=str(post.id), actor_id=str(user.id), recipient_id=str(post.author_id)
            )
    post.refresh_from_db(fields=["likes_count"])
    return liked, post.likes_count


def list_likers(user, post_id, limit=100):
    post = get_visible_post(user, post_id)
    ids = list(Like.objects.filter(post=post).order_by("-created_at").values_list("user_id", flat=True)[:limit])
    summaries = user_services.get_user_summaries(ids)
    return [summaries[str(i)] for i in ids if str(i) in summaries]


# ------------------------------------------------------------------ UC-15: Bình luận đa cấp
def list_comments(user, post_id):
    post = get_visible_post(user, post_id)
    blocked = user_services.get_blocked_ids(user.id)
    comments = list(Comment.objects.filter(post=post).exclude(user_id__in=blocked).order_by("created_at"))
    users = user_services.get_user_summaries({c.user_id for c in comments})
    nodes = {}
    for c in comments:
        nodes[str(c.id)] = {
            "id": str(c.id),
            "user": users.get(str(c.user_id)),
            "parent_id": str(c.parent_id) if c.parent_id else None,
            "content": c.content,
            "is_edited": c.is_edited,
            "can_edit": str(c.user_id) == str(user.id),
            "can_delete": str(c.user_id) == str(user.id) or str(post.author_id) == str(user.id) or _is_admin(user),
            "created_at": c.created_at.isoformat(),
            "replies": [],
        }
    roots = []
    for node in nodes.values():
        parent = nodes.get(node["parent_id"]) if node["parent_id"] else None
        (parent["replies"] if parent else roots).append(node)
    return roots


@transaction.atomic
def create_comment(user, post_id, content, parent_id=None):
    post = get_visible_post(user, post_id)
    content = sanitize_text(content, 2000)
    if not content:
        raise ServiceError("Nội dung bình luận không được để trống")
    parent = None
    if parent_id:
        parent = Comment.objects.filter(id=parent_id, post=post).first()
        if not parent:
            raise NotFound("Bình luận gốc không tồn tại")
    flagged_words = badwords.find_badwords(content)
    if flagged_words:
        content = badwords.censor(content)
    comment = Comment.objects.create(post=post, user=user, parent=parent, content=content)
    Post.objects.filter(id=post.id).update(comments_count=F("comments_count") + 1)
    recipients = {str(post.author_id)}
    if parent:
        recipients.add(str(parent.user_id))
    recipients.discard(str(user.id))
    events.publish(
        events.COMMENT_CREATED,
        comment_id=str(comment.id),
        post_id=str(post.id),
        actor_id=str(user.id),
        recipient_ids=sorted(recipients),
        post_author_id=str(post.author_id),
        is_reply=bool(parent),
    )
    if flagged_words:
        events.publish(events.COMMENT_FLAGGED, comment_id=str(comment.id), author_id=str(user.id), words=flagged_words)
    return comment


def update_comment(user, comment_id, content):
    comment = Comment.objects.filter(id=comment_id, user=user).first()
    if not comment:
        raise NotFound("Không tìm thấy bình luận")
    content = sanitize_text(content, 2000)
    if not content:
        raise ServiceError("Nội dung bình luận không được để trống")
    comment.content = badwords.censor(content)
    comment.is_edited = True
    comment.save()
    return comment


def _delete_comment_tree(comment):
    ids = [comment.id]
    frontier = [comment.id]
    while frontier:
        frontier = list(Comment.objects.filter(parent_id__in=frontier).values_list("id", flat=True))
        ids += frontier
    Comment.objects.filter(id__in=ids).delete()
    Post.objects.filter(id=comment.post_id).update(comments_count=F("comments_count") - len(ids))
    Post.objects.filter(id=comment.post_id, comments_count__lt=0).update(comments_count=0)
    return len(ids)


@transaction.atomic
def delete_comment_by_user(user, comment_id):
    comment = Comment.objects.select_related("post").filter(id=comment_id).first()
    if not comment:
        raise NotFound("Không tìm thấy bình luận")
    if not (str(comment.user_id) == str(user.id) or str(comment.post.author_id) == str(user.id) or _is_admin(user)):
        raise PermissionDenied("Bạn không có quyền xóa bình luận này")
    return _delete_comment_tree(comment)


# ------------------------------------------------------------------ UC-16: Chia sẻ
@transaction.atomic
def share_post(user, post_id, content=""):
    post = get_visible_post(user, post_id)
    if post.privacy != Post.Privacy.PUBLIC or post.group_id:
        raise ServiceError("Chỉ có thể chia sẻ bài viết công khai")
    share = Share.objects.create(post=post, user=user, shared_content=badwords.censor(sanitize_text(content, 2000)))
    Post.objects.filter(id=post.id).update(shares_count=F("shares_count") + 1)
    if str(post.author_id) != str(user.id):
        events.publish(
            events.POST_SHARED, post_id=str(post.id), actor_id=str(user.id), recipient_id=str(post.author_id)
        )
    return share


def list_shares_of_user(viewer, user_id, limit=30):
    if str(viewer.id) != str(user_id) and user_services.is_blocked(viewer.id, user_id):
        raise NotFound("Không tìm thấy người dùng")
    shares = list(Share.objects.filter(user_id=user_id, post__deleted_at__isnull=True).select_related("post")[:limit])
    visible = [s for s in shares if can_view(viewer, s.post)]
    posts = {p["id"]: p for p in serialize_posts([s.post for s in visible], viewer)}
    sharer = user_services.get_user_summary(user_id)
    return [
        {
            "id": str(s.id),
            "user": sharer,
            "content": s.shared_content,
            "created_at": s.created_at.isoformat(),
            "post": posts.get(str(s.post_id)),
        }
        for s in visible
    ]


# ------------------------------------------------------------------ Giao diện cho phân hệ Admin / Group
def get_post_brief(post_id):
    p = Post.objects.filter(id=post_id).first()
    if not p:
        return None
    return {
        "id": str(p.id),
        "author_id": str(p.author_id),
        "group_id": str(p.group_id) if p.group_id else None,
        "content": p.content[:300],
        "is_flagged": p.is_flagged,
        "deleted": p.deleted_at is not None,
    }


def get_comment_brief(comment_id):
    c = Comment.objects.filter(id=comment_id).first()
    if not c:
        return None
    return {"id": str(c.id), "author_id": str(c.user_id), "post_id": str(c.post_id), "content": c.content[:300]}


def soft_delete_post(post_id):
    post = Post.objects.filter(id=post_id).first()
    if not post or post.deleted_at:
        return False
    post.deleted_at = timezone.now()
    post.save(update_fields=["deleted_at", "updated_at"])
    _invalidate_author_audience(post.author_id)
    events.publish(events.POST_DELETED, post_id=str(post.id), author_id=str(post.author_id))
    return True


def unflag_post(post_id):
    updated = Post.objects.filter(id=post_id).update(is_flagged=False)
    post = Post.objects.filter(id=post_id).first()
    if post:
        _invalidate_author_audience(post.author_id)
    return bool(updated)


def delete_comment(comment_id):
    comment = Comment.objects.filter(id=comment_id).first()
    if not comment:
        return 0
    with transaction.atomic():
        return _delete_comment_tree(comment)


def soft_delete_group_posts(group_id):
    return Post.objects.filter(group_id=group_id, deleted_at__isnull=True).update(deleted_at=timezone.now())


def post_stats(days=14):
    return {
        "total_posts": Post.objects.filter(deleted_at__isnull=True).count(),
        "flagged_posts": Post.objects.filter(is_flagged=True, deleted_at__isnull=True).count(),
        "total_comments": Comment.objects.count(),
        "total_likes": Like.objects.count(),
        "posts_per_day": count_per_day(Post.objects.all(), days=days),
    }
