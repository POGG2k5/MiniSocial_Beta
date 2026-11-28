"""UC-07 -> UC-10: hồ sơ, tìm kiếm không dấu, máy trạng thái kết bạn, chặn."""

import pytest

from apps.users import services

from .conftest import auth_client, befriend
from .factories import UserFactory

pytestmark = pytest.mark.django_db


def test_profile_view_and_update(client_a, client_b, user, settings):
    r = client_a.patch(
        "/api/v1/users/me/", {"bio": "<b>Xin chào</b><script>alert(1)</script>", "location": "Hà Nội"}, format="json"
    )
    assert r.status_code == 200
    assert r.data["data"]["bio"] == "Xin chàoalert(1)"  # Bleach loại bỏ thẻ HTML
    r = client_a.patch("/api/v1/users/me/", {"avatar_url": "https://evil.com/x.png"}, format="json")
    assert r.status_code == 400
    r = client_a.patch(
        "/api/v1/users/me/", {"avatar_url": settings.MEDIA_PUBLIC_BASE_URL + "/avatars/a.webp"}, format="json"
    )
    assert r.status_code == 200
    r = client_b.get(f"/api/v1/users/{user.id}/")
    assert r.data["data"]["location"] == "Hà Nội"
    assert r.data["data"]["relationship"]["status"] == "NONE"
    assert "email" not in r.data["data"]


@pytest.mark.django_db(transaction=True)  # FULLTEXT của MySQL chỉ thấy dữ liệu đã commit
def test_search_without_diacritics(client_a):
    UserFactory(full_name="Nguyễn Văn Đức")
    UserFactory(full_name="Trần Thị Mai")
    r = client_a.get("/api/v1/users/search/?q=van duc")
    assert [u["full_name"] for u in r.data["data"]] == ["Nguyễn Văn Đức"]
    r = client_a.get("/api/v1/users/search/?q=Đức")
    assert len(r.data["data"]) == 1


def test_friend_state_machine(client_a, client_b, user, other):
    r = client_a.post("/api/v1/users/friends/requests/", {"user_id": str(other.id)}, format="json")
    assert r.status_code == 201
    fid = r.data["data"]["id"]
    assert services.relationship(user.id, other.id)["status"] == "PENDING_SENT"
    assert services.relationship(other.id, user.id)["status"] == "PENDING_RECEIVED"
    # gửi trùng
    assert (
        client_a.post("/api/v1/users/friends/requests/", {"user_id": str(other.id)}, format="json").status_code == 400
    )
    # người gửi không được tự chấp nhận
    assert client_a.post(f"/api/v1/users/friends/requests/{fid}/accept/").status_code == 404
    r = client_b.get("/api/v1/users/friends/requests/?direction=received")
    assert len(r.data["data"]) == 1
    assert client_b.post(f"/api/v1/users/friends/requests/{fid}/accept/").status_code == 200
    assert services.are_friends(user.id, other.id)
    r = client_a.get("/api/v1/users/friends/")
    assert r.data["data"][0]["id"] == str(other.id)
    assert client_a.delete(f"/api/v1/users/friends/{other.id}/").status_code == 200
    assert services.relationship(user.id, other.id)["status"] == "NONE"


def test_decline_and_cancel(client_a, client_b, other):
    fid = client_a.post("/api/v1/users/friends/requests/", {"user_id": str(other.id)}, format="json").data["data"]["id"]
    assert client_b.post(f"/api/v1/users/friends/requests/{fid}/decline/").status_code == 200
    fid = client_a.post("/api/v1/users/friends/requests/", {"user_id": str(other.id)}, format="json").data["data"]["id"]
    assert client_a.delete(f"/api/v1/users/friends/requests/{fid}/").status_code == 200


def test_mutual_request_auto_accept(user, other):
    services.send_friend_request(user, other.id)
    f = services.send_friend_request(other, user.id)
    assert f.status == "ACCEPTED"


def test_block_removes_friendship_and_hides_profile(client_a, client_b, user, other):
    befriend(user, other)
    assert client_a.post("/api/v1/users/blocks/", {"user_id": str(other.id)}, format="json").status_code == 201
    assert not services.are_friends(user.id, other.id)
    assert client_b.get(f"/api/v1/users/{user.id}/").status_code == 404
    assert client_b.post("/api/v1/users/friends/requests/", {"user_id": str(user.id)}, format="json").status_code == 403
    assert len(client_a.get("/api/v1/users/blocks/").data["data"]) == 1
    assert client_a.delete(f"/api/v1/users/blocks/{other.id}/").status_code == 200


def test_suggestions_prefer_friends_of_friends(user, other):
    third = UserFactory()
    befriend(user, other)
    befriend(other, third)
    ids = [s["id"] for s in auth_client(user).get("/api/v1/users/suggestions/").data["data"]]
    assert ids[0] == str(third.id)
    assert str(other.id) not in ids


@pytest.mark.django_db(transaction=True)  # FULLTEXT của MySQL chỉ thấy dữ liệu đã commit
def test_mutual_friend_counts_in_suggestions_search_and_profile(user, other):
    """UPDATE_ADDFRIEND_01: gợi ý kết bạn, tìm kiếm và trang cá nhân hiện số bạn chung."""
    target = UserFactory(full_name="Bạn Chung Thử")
    third = UserFactory()
    befriend(user, other)
    befriend(user, third)
    befriend(other, target)
    befriend(third, target)
    client = auth_client(user)
    suggestion = next(s for s in client.get("/api/v1/users/suggestions/").data["data"] if s["id"] == str(target.id))
    assert suggestion["mutual_friends_count"] == 2
    found = client.get("/api/v1/users/search/?q=ban chung thu").data["data"]
    assert next(u for u in found if u["id"] == str(target.id))["mutual_friends_count"] == 2
    assert client.get(f"/api/v1/users/{target.id}/").data["data"]["mutual_friends_count"] == 2
    assert "mutual_friends_count" not in client.get(f"/api/v1/users/{user.id}/").data["data"]
    assert services.mutual_friend_counts(user.id, [other.id])[str(other.id)] == 0
