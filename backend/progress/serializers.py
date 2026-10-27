import json

from rest_framework import serializers

from .models import Bookmark, CampaignProgress, EventDiscovery, GameSave, UserAchievement, UserActivity


class BookmarkSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bookmark
        fields = ("id", "item_type", "item_id", "title", "created_at")
        read_only_fields = ("id", "created_at")

    def validate(self, attrs):
        item_type = attrs.get("item_type", getattr(self.instance, "item_type", None))
        item_id = attrs.get("item_id", getattr(self.instance, "item_id", None))
        title = attrs.get("title", getattr(self.instance, "title", None))
        if not item_id or len(item_id) > 160 or not title or not title.strip():
            raise serializers.ValidationError("A valid saved event or scenario is required.")
        if item_type in {"event", "scenario"}:
            from .services import is_known_event

            if not is_known_event(item_id):
                raise serializers.ValidationError({"item_id": "This item is not in the historical catalogue."})
        return attrs

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Title cannot be empty.")
        return value[:200]


class GameSaveSerializer(serializers.ModelSerializer):
    expected_revision = serializers.IntegerField(write_only=True, required=False, min_value=1)

    class Meta:
        model = GameSave
        fields = (
            "id",
            "name",
            "campaign_id",
            "scenario_id",
            "faction",
            "turn",
            "game_date",
            "game_state",
            "format_version",
            "revision",
            "expected_revision",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "revision", "created_at", "updated_at")

    def validate(self, attrs):
        if self.instance and "expected_revision" not in attrs:
            raise serializers.ValidationError(
                {"expected_revision": "The save revision is required to safely update this game."}
            )
        if self.instance and attrs.get("expected_revision") != self.instance.revision:
            raise serializers.ValidationError(
                {"expected_revision": "This save changed elsewhere. Reload it before updating."}
            )
        return attrs

    def update(self, instance, validated_data):
        validated_data.pop("expected_revision", None)
        instance = super().update(instance, validated_data)
        instance.revision += 1
        instance.save(update_fields=["revision"])
        return instance

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Save name cannot be empty.")
        request = self.context.get("request")
        if request:
            saves = GameSave.objects.filter(owner=request.user, name__iexact=value)
            if self.instance:
                saves = saves.exclude(pk=self.instance.pk)
            if saves.exists():
                raise serializers.ValidationError("A save with this name already exists.")
        return value

    def validate_campaign_id(self, value):
        value = value.strip()
        if not value or len(value) > 120:
            raise serializers.ValidationError("A valid campaign identifier is required.")
        return value

    def validate_format_version(self, value):
        if value != 1:
            raise serializers.ValidationError("This save format version is not supported.")
        return value

    def validate_game_state(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Game state must be a JSON object no larger than 1 MB.")
        try:
            encoded = json.dumps(value, separators=(",", ":"))
        except (TypeError, ValueError) as error:
            raise serializers.ValidationError("Game state must contain JSON-compatible values.") from error
        if len(encoded) > 1_000_000:
            raise serializers.ValidationError("Game state must be a JSON object no larger than 1 MB.")
        scores = value.get("state")
        if scores is not None and (
            not isinstance(scores, dict)
            or any(not isinstance(score, (int, float)) or isinstance(score, bool) for score in scores.values())
        ):
            raise serializers.ValidationError("Game state contains invalid indicator values.")
        choices = value.get("choices")
        entries = value.get("entries")
        if choices is not None and (not isinstance(choices, list) or len(choices) > 100):
            raise serializers.ValidationError("Game state contains an invalid decision history.")
        if entries is not None and (not isinstance(entries, list) or len(entries) > 500):
            raise serializers.ValidationError("Game state contains an invalid timeline.")
        return value


class EventDiscoverySerializer(serializers.ModelSerializer):
    class Meta:
        model = EventDiscovery
        fields = ("event_id",)

    def validate_event_id(self, value):
        from .services import is_known_event

        if not is_known_event(value):
            raise serializers.ValidationError("This event is not present in the shared historical catalogue.")
        return value


class CampaignProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = CampaignProgress
        fields = ("campaign_id", "status", "completed_objectives", "total_objectives", "last_save", "started_at", "last_played_at", "completed_at")


class UserAchievementSerializer(serializers.ModelSerializer):
    slug = serializers.CharField(source="achievement.slug")
    name = serializers.CharField(source="achievement.name")
    description = serializers.CharField(source="achievement.description")

    class Meta:
        model = UserAchievement
        fields = ("slug", "name", "description", "unlocked_at")


class UserActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = UserActivity
        fields = ("activity_type", "description", "metadata", "created_at")
