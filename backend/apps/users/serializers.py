from rest_framework import serializers

from . import services


class UserBriefSerializer(serializers.Serializer):
    def to_representation(self, user):
        return services.summarize(user)


class ProfileUpdateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=100, required=False)
    bio = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    location = serializers.CharField(max_length=100, required=False, allow_blank=True)
    birth_date = serializers.DateField(required=False, allow_null=True)
    avatar_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    cover_url = serializers.CharField(max_length=500, required=False, allow_blank=True)


class TargetUserSerializer(serializers.Serializer):
    user_id = serializers.UUIDField()


def profile_payload(user, viewer=None):
    profile = services.get_profile(user)
    data = {
        **services.summarize(user),
        "cover_url": profile.cover_url,
        "bio": profile.bio,
        "location": profile.location,
        "birth_date": profile.birth_date.isoformat() if profile.birth_date else None,
        "friends_count": services.friends_count(user.id),
        "joined_at": user.created_at.isoformat(),
    }
    if viewer is not None:
        data["relationship"] = services.relationship(viewer.id, user.id)
        if str(viewer.id) == str(user.id):
            data["email"] = user.email
        else:
            data["mutual_friends_count"] = services.mutual_friend_counts(viewer.id, [user.id])[str(user.id)]
    return data


def friend_request_payload(f):
    return {
        "id": str(f.id),
        "sender": services.summarize(f.sender),
        "receiver": services.summarize(f.receiver),
        "status": f.status,
        "created_at": f.created_at.isoformat(),
    }
