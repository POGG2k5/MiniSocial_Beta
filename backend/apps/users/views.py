from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.views import APIView

from common.exceptions import NotFound
from common.responses import api_success

from . import services
from .serializers import (
    ProfileUpdateSerializer,
    TargetUserSerializer,
    friend_request_payload,
    profile_payload,
)


class MyProfileView(APIView):
    """UC-07: xem / cập nhật hồ sơ của chính mình."""

    def get(self, request):
        return api_success(profile_payload(request.user, request.user))

    @extend_schema(request=ProfileUpdateSerializer)
    def patch(self, request):
        s = ProfileUpdateSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        services.update_profile(request.user, s.validated_data)
        return api_success(profile_payload(request.user, request.user), "Đã cập nhật hồ sơ")


class UserProfileView(APIView):
    """UC-07: xem trang cá nhân người khác (bị chặn thì coi như không tồn tại)."""

    def get(self, request, user_id):
        user = services.get_active_user_or_404(user_id)
        if services.is_blocked(request.user.id, user.id) and str(user.id) != str(request.user.id):
            rel = services.relationship(request.user.id, user.id)
            if rel["status"] == services.BLOCKED_BY:
                raise NotFound("Không tìm thấy người dùng")
        return api_success(profile_payload(user, request.user))


class SearchView(APIView):
    """UC-08: tìm kiếm người dùng theo tên tiếng Việt có/không dấu."""

    def get(self, request):
        q = request.query_params.get("q", "").strip()
        users = services.search(request.user, q) if len(q) >= 2 else []
        return api_success(
            [
                {**item, "relationship": services.relationship(request.user.id, item["id"])}
                for item in services.summarize_with_mutual(request.user, users)
            ]
        )


class SuggestionsView(APIView):
    def get(self, request):
        return api_success(services.summarize_with_mutual(request.user, services.suggestions(request.user)))


class FriendListView(APIView):
    """Danh sách bạn bè của mình hoặc của người khác (?user_id=)."""

    def get(self, request):
        uid = request.query_params.get("user_id") or request.user.id
        if str(uid) != str(request.user.id) and services.is_blocked(request.user.id, uid):
            raise NotFound("Không tìm thấy người dùng")
        return api_success([services.summarize(u) for u in services.list_friends(uid)])


class UnfriendView(APIView):
    def delete(self, request, user_id):
        services.unfriend(request.user, user_id)
        return api_success(message="Đã hủy kết bạn")


class FriendRequestListCreateView(APIView):
    """UC-09: xem lời mời (direction=received|sent) / gửi lời mời kết bạn."""

    def get(self, request):
        direction = request.query_params.get("direction", "received")
        return api_success([friend_request_payload(f) for f in services.list_requests(request.user, direction)])

    @extend_schema(request=TargetUserSerializer)
    def post(self, request):
        s = TargetUserSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        f = services.send_friend_request(request.user, s.validated_data["user_id"])
        msg = "Hai bạn đã trở thành bạn bè!" if f.status == "ACCEPTED" else "Đã gửi lời mời kết bạn"
        return api_success({"id": str(f.id), "status": f.status}, msg, status.HTTP_201_CREATED)


class FriendRequestAcceptView(APIView):
    @extend_schema(request=None)
    def post(self, request, friendship_id):
        services.accept_friend_request(request.user, friendship_id)
        return api_success(message="Đã chấp nhận lời mời kết bạn")


class FriendRequestDeclineView(APIView):
    @extend_schema(request=None)
    def post(self, request, friendship_id):
        services.decline_friend_request(request.user, friendship_id)
        return api_success(message="Đã từ chối lời mời")


class FriendRequestCancelView(APIView):
    def delete(self, request, friendship_id):
        services.cancel_friend_request(request.user, friendship_id)
        return api_success(message="Đã thu hồi lời mời")


class BlockListCreateView(APIView):
    """UC-10: danh sách chặn / chặn người dùng."""

    def get(self, request):
        return api_success([services.summarize(u) for u in services.list_blocked(request.user)])

    @extend_schema(request=TargetUserSerializer)
    def post(self, request):
        s = TargetUserSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.block_user(request.user, s.validated_data["user_id"])
        return api_success(message="Đã chặn người dùng", status_code=status.HTTP_201_CREATED)


class UnblockView(APIView):
    def delete(self, request, user_id):
        services.unblock_user(request.user, user_id)
        return api_success(message="Đã bỏ chặn")
