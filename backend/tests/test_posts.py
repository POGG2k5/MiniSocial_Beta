"""UC-11 -> UC-16: đăng bài + media, quyền riêng tư, feed, like, bình luận cây, chia sẻ."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.media_files.models import PostMedia
from apps.posts.models import Post

from .conftest import auth_client, befriend, make_image
from .factories import UserFactory

pytestmark = pytest.mark.django_db


def _post(client, **data):
    return client.post("/api/v1/posts/", data, format="multipart")


def test_create_post_with_images_processed_to_webp(client_a, settings):
    r = _post(
        client_a, content="Ảnh đẹp", privacy="FRIENDS", files=[make_image("a.png"), make_image("b.jpg", fmt="JPEG")]
    )
    assert r.status_code == 201, r.data
    media = r.data["data"]["media"]
    assert len(media) == 2 and all(m["file_url"].endswith(".webp") for m in media)
    assert all(m["thumbnail_url"].endswith("_thumb.webp") for m in media)
    # Celery (eager) đã nén và đánh dấu READY
    assert set(PostMedia.objects.values_list("status", flat=True)) == {"READY"}
    stored = list((settings.MEDIA_ROOT / "posts").iterdir())
    assert len(stored) == 4


def test_reject_fake_image_and_empty_post(client_a):
    fake = SimpleUploadedFile("virus.png", b"MZ\x90\x00 not an image", content_type="image/png")
    r = _post(client_a, content="x", files=[fake])
    assert r.status_code == 400 and r.data["code"] == "FILE_TYPE_NOT_ALLOWED"
    assert _post(client_a, content="   ").status_code == 400


def test_reject_oversized_file(client_a, settings):
    settings.MAX_UPLOAD_MB = 0
    r = _post(client_a, content="x", files=[make_image()])
    assert r.data["code"] == "FILE_TOO_LARGE"


def test_xss_is_stripped(client_a):
    r = _post(client_a, content="<img src=x onerror=alert(1)>Xin chào <b>bạn</b>")
    assert r.data["data"]["content"] == "Xin chào bạn"


def test_feed_rules(user, other):
    stranger = UserFactory()
    a, b, s = auth_client(user), auth_client(other), auth_client(stranger)
    # chưa có bạn bè -> has_friends False nhưng vẫn thấy bài của mình
    _post(a, content="Bài của tôi")
    r = a.get("/api/v1/posts/feed/")
    assert r.data["data"]["has_friends"] is False and len(r.data["data"]["results"]) == 1

    befriend(user, other)
    _post(b, content="Public", privacy="PUBLIC")
    _post(b, content="Bạn bè", privacy="FRIENDS")
    _post(b, content="Riêng tư", privacy="PRIVATE")
    _post(s, content="Người lạ", privacy="PUBLIC")
    contents = {p["content"] for p in a.get("/api/v1/posts/feed/").data["data"]["results"]}
    assert contents == {"Bài của tôi", "Public", "Bạn bè"}
    # lần 2 lấy từ Redis cache
    assert a.get("/api/v1/posts/feed/").data["data"]["cached"] is True


def test_feed_cursor_pagination(user, other):
    befriend(user, other)
    b = auth_client(other)
    for i in range(15):
        _post(b, content=f"bài {i}")
    a = auth_client(user)
    r = a.get("/api/v1/posts/feed/")
    assert len(r.data["data"]["results"]) == 10 and r.data["data"]["next"]
    nxt = r.data["data"]["next"].split("/api/v1/posts/feed/")[1]
    r2 = a.get("/api/v1/posts/feed/" + nxt)
    assert len(r2.data["data"]["results"]) == 5
    ids = {p["id"] for p in r.data["data"]["results"]} | {p["id"] for p in r2.data["data"]["results"]}
    assert len(ids) == 15


def test_privacy_on_detail_and_profile(user, other):
    a, b = auth_client(user), auth_client(other)
    pid = _post(a, content="bí mật", privacy="FRIENDS").data["data"]["id"]
    assert b.get(f"/api/v1/posts/{pid}/").status_code == 404
    befriend(user, other)
    assert b.get(f"/api/v1/posts/{pid}/").status_code == 200
    r = b.get(f"/api/v1/posts/user/{user.id}/")
    assert len(r.data["data"]["results"]) == 1


def test_edit_delete_pin(client_a, client_b):
    pid = _post(client_a, content="cũ").data["data"]["id"]
    assert client_b.patch(f"/api/v1/posts/{pid}/", {"content": "hack"}, format="json").status_code == 403
    r = client_a.patch(f"/api/v1/posts/{pid}/", {"content": "mới", "privacy": "PRIVATE"}, format="json")
    assert r.data["data"]["content"] == "mới" and r.data["data"]["is_edited"]
    assert client_a.post(f"/api/v1/posts/{pid}/pin/").data["data"]["is_pinned"] is True
    assert client_a.delete(f"/api/v1/posts/{pid}/").status_code == 200
    assert Post.objects.get(id=pid).deleted_at is not None  # xóa mềm


def test_like_toggle_and_notification(user, other):
    from apps.notifications.models import Notification

    a, b = auth_client(user), auth_client(other)
    pid = _post(a, content="like đi").data["data"]["id"]
    assert b.post(f"/api/v1/posts/{pid}/like/").data["data"] == {"is_liked": True, "likes_count": 1}
    assert Notification.objects.filter(recipient=user, verb="POST_LIKED").count() == 1
    assert b.post(f"/api/v1/posts/{pid}/like/").data["data"] == {"is_liked": False, "likes_count": 0}
    b.post(f"/api/v1/posts/{pid}/like/")
    assert Notification.objects.filter(recipient=user, verb="POST_LIKED").count() == 1  # chống spam
    assert len(a.get(f"/api/v1/posts/{pid}/like/").data["data"]) == 1


def test_comment_tree_and_delete_subtree(user, other):
    a, b = auth_client(user), auth_client(other)
    pid = _post(a, content="bàn luận").data["data"]["id"]
    c1 = b.post(f"/api/v1/posts/{pid}/comments/", {"content": "cấp 1"}, format="json").data["data"]["id"]
    c2 = a.post(f"/api/v1/posts/{pid}/comments/", {"content": "cấp 2", "parent_id": c1}, format="json").data["data"][
        "id"
    ]
    b.post(f"/api/v1/posts/{pid}/comments/", {"content": "cấp 3", "parent_id": c2}, format="json")
    tree = a.get(f"/api/v1/posts/{pid}/comments/").data["data"]
    assert tree[0]["replies"][0]["replies"][0]["content"] == "cấp 3"
    assert Post.objects.get(id=pid).comments_count == 3
    assert b.patch(f"/api/v1/posts/comments/{c1}/", {"content": "sửa"}, format="json").status_code == 200
    # chủ bài viết xóa bình luận gốc -> xóa cả nhánh
    assert a.delete(f"/api/v1/posts/comments/{c1}/").data["data"]["removed"] == 3
    assert Post.objects.get(id=pid).comments_count == 0


def test_share_only_public(client_a, client_b, user):
    pub = _post(client_a, content="chia sẻ đi").data["data"]["id"]
    priv = _post(client_a, content="riêng", privacy="PRIVATE").data["data"]["id"]
    assert client_b.post(f"/api/v1/posts/{pub}/share/", {"content": "hay"}, format="json").status_code == 201
    assert client_b.post(f"/api/v1/posts/{priv}/share/").status_code == 404
    assert Post.objects.get(id=pub).shares_count == 1
    shares = client_a.get(f"/api/v1/posts/user/{client_b.user.id}/shares/").data["data"]
    assert shares[0]["post"]["id"] == pub


def test_badwords_flag_post_and_auto_report(client_a, client_b, user):
    from apps.admin_management.models import Report

    r = _post(client_a, content="Đồ óc chó vcl")
    assert r.data["data"]["is_flagged"] is True
    report = Report.objects.get()
    assert report.is_auto and report.reported_user_id == user.id
    assert client_b.get(f"/api/v1/posts/{r.data['data']['id']}/").status_code == 404  # ẩn với người khác


def test_comment_badwords_censored(client_a):
    pid = _post(client_a, content="ok").data["data"]["id"]
    r = client_a.post(f"/api/v1/posts/{pid}/comments/", {"content": "đm thật"}, format="json")
    assert r.data["data"]["content"] == "** thật"


@pytest.mark.parametrize("viewer_kind", ["stranger", "friend", "admin"])
def test_profile_timeline_respects_privacy_for_every_viewer(user, other, admin_user, viewer_kind):
    """BG_PROFILE_01: người khác (kể cả quản trị viên) không thấy bài riêng tư trên trang cá nhân."""
    owner = auth_client(user)
    for privacy in ("PUBLIC", "FRIENDS", "PRIVATE"):
        _post(owner, content=privacy, privacy=privacy)
    if viewer_kind == "friend":
        befriend(user, other)
        viewer = auth_client(other)
    elif viewer_kind == "admin":
        viewer = auth_client(admin_user)
    else:
        viewer = auth_client(UserFactory())
    seen = {p["content"] for p in viewer.get(f"/api/v1/posts/user/{user.id}/").data["data"]["results"]}
    expected = {"PUBLIC", "FRIENDS"} if viewer_kind == "friend" else {"PUBLIC"}
    assert seen == expected
    assert {p["content"] for p in owner.get(f"/api/v1/posts/user/{user.id}/").data["data"]["results"]} == {
        "PUBLIC",
        "FRIENDS",
        "PRIVATE",
    }
