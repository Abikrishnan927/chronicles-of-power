import uuid

from django.conf import settings
from django.db import models


class GameSave(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="game_saves")
    name = models.CharField(max_length=80)
    campaign_id = models.CharField(max_length=120)
    scenario_id = models.CharField(max_length=120, blank=True)
    faction = models.CharField(max_length=120, blank=True)
    turn = models.PositiveIntegerField(default=0)
    game_date = models.CharField(max_length=80, blank=True)
    game_state = models.JSONField()
    format_version = models.PositiveSmallIntegerField(default=1)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["owner", "-updated_at"])]
        constraints = [
            models.UniqueConstraint(fields=["owner", "name"], name="progress_save_name_per_owner"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.owner})"


class CampaignProgress(models.Model):
    class Status(models.TextChoices):
        IN_PROGRESS = "in_progress", "In progress"
        COMPLETED = "completed", "Completed"
        ABANDONED = "abandoned", "Abandoned"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="campaign_progress")
    last_save = models.ForeignKey(
        GameSave,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="last_played_by",
    )
    campaign_id = models.CharField(max_length=120)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.IN_PROGRESS)
    completed_objectives = models.JSONField(default=list, blank=True)
    total_objectives = models.PositiveSmallIntegerField(default=0)
    started_at = models.DateTimeField(auto_now_add=True)
    last_played_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_played_at"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "campaign_id"], name="progress_campaign_per_owner"),
        ]
        indexes = [models.Index(fields=["owner", "status"])]


class EventDiscovery(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="event_discoveries")
    event_id = models.CharField(max_length=160)
    discovered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-discovered_at"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "event_id"], name="progress_discovery_per_owner"),
        ]


class Bookmark(models.Model):
    ITEM_TYPES = [("event", "Historical event"), ("scenario", "Scenario")]

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookmarks")
    item_type = models.CharField(max_length=12, choices=ITEM_TYPES)
    item_id = models.CharField(max_length=160)
    title = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "item_type", "item_id"], name="progress_bookmark_per_owner"),
        ]


class Achievement(models.Model):
    slug = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300)
    criteria = models.CharField(max_length=300)

    def __str__(self) -> str:
        return self.name


class UserAchievement(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="achievements")
    achievement = models.ForeignKey(Achievement, on_delete=models.CASCADE, related_name="unlocks")
    unlocked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-unlocked_at"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "achievement"], name="progress_achievement_per_owner"),
        ]


class UserActivity(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="activity")
    activity_type = models.CharField(max_length=40)
    description = models.CharField(max_length=200)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner", "-created_at"])]
