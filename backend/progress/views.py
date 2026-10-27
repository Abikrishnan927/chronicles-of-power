from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import APIException
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Achievement, Bookmark, CampaignProgress, EventDiscovery, GameSave, UserAchievement, UserActivity
from .serializers import (
    CampaignProgressSerializer,
    BookmarkSerializer,
    EventDiscoverySerializer,
    GameSaveSerializer,
    UserAchievementSerializer,
    UserActivitySerializer,
)
from .services import is_verified_completion


class AuthenticatedView(APIView):
    permission_classes = [permissions.IsAuthenticated]


class SaveConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This save changed elsewhere. Reload it before updating."
    default_code = "save_conflict"


class SaveListView(AuthenticatedView):
    def get(self, request):
        serializer = GameSaveSerializer(GameSave.objects.filter(owner=request.user), many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = GameSaveSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                save = serializer.save(owner=request.user)
                progress, _ = CampaignProgress.objects.get_or_create(
                    owner=request.user,
                    campaign_id=save.campaign_id,
                )
                progress.last_save = save
                progress.last_played_at = timezone.now()
                if is_verified_completion(save.campaign_id, save.game_state) and progress.status != CampaignProgress.Status.COMPLETED:
                    progress.status = CampaignProgress.Status.COMPLETED
                    progress.completed_at = timezone.now()
                progress.save()
                UserActivity.objects.create(
                    owner=request.user,
                    activity_type="game_saved",
                    description=f"Saved {save.name}",
                    metadata={"save_id": str(save.pk), "campaign_id": save.campaign_id},
                )
                award_first_save(request.user)
        except IntegrityError as error:
            raise ValidationError({"name": "A save with this name already exists."}) from error
        return Response(GameSaveSerializer(save).data, status=status.HTTP_201_CREATED)


class SaveDetailView(AuthenticatedView):
    def get_object(self, request, pk):
        try:
            return GameSave.objects.get(pk=pk, owner=request.user)
        except GameSave.DoesNotExist as error:
            from rest_framework.exceptions import NotFound

            raise NotFound("Save not found.") from error

    def get(self, request, pk):
        return Response(GameSaveSerializer(self.get_object(request, pk)).data)

    def patch(self, request, pk):
        with transaction.atomic():
            try:
                save = GameSave.objects.select_for_update().get(pk=pk, owner=request.user)
            except GameSave.DoesNotExist as error:
                from rest_framework.exceptions import NotFound

                raise NotFound("Save not found.") from error
            expected_revision = request.data.get("expected_revision")
            if expected_revision is None or str(expected_revision) != str(save.revision):
                raise SaveConflict()
            serializer = GameSaveSerializer(save, data=request.data, partial=True, context={"request": request})
            serializer.is_valid(raise_exception=True)
            save = serializer.save()
            progress = CampaignProgress.objects.select_for_update().filter(
                owner=request.user, campaign_id=save.campaign_id
            ).first()
            if progress:
                progress.last_save = save
                progress.last_played_at = timezone.now()
                if is_verified_completion(save.campaign_id, save.game_state) and progress.status != CampaignProgress.Status.COMPLETED:
                    progress.status = CampaignProgress.Status.COMPLETED
                    progress.completed_at = timezone.now()
                progress.save()
            UserActivity.objects.create(
                owner=request.user,
                activity_type="game_saved",
                description=f"Saved {save.name}",
                metadata={"save_id": str(save.pk), "campaign_id": save.campaign_id},
            )
        return Response(GameSaveSerializer(save).data)

    def delete(self, request, pk):
        self.get_object(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResumeSaveView(AuthenticatedView):
    def post(self, request, pk):
        try:
            save = GameSave.objects.get(pk=pk, owner=request.user)
        except GameSave.DoesNotExist as error:
            from rest_framework.exceptions import NotFound

            raise NotFound("Save not found.") from error
        with transaction.atomic():
            progress, _ = CampaignProgress.objects.get_or_create(
                owner=request.user, campaign_id=save.campaign_id
            )
            progress.last_save = save
            progress.last_played_at = timezone.now()
            progress.save(update_fields=["last_save", "last_played_at"])
            UserActivity.objects.create(
                owner=request.user,
                activity_type="campaign_resumed",
                description=f"Resumed {save.name}",
                metadata={"save_id": str(save.pk), "campaign_id": save.campaign_id},
            )
        return Response(GameSaveSerializer(save).data)


class EventDiscoveryView(AuthenticatedView):
    def post(self, request):
        serializer = EventDiscoverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event_id = serializer.validated_data["event_id"]
        discovery, created = EventDiscovery.objects.get_or_create(owner=request.user, event_id=event_id)
        if created:
            UserActivity.objects.create(
                owner=request.user,
                activity_type="event_discovered",
                description="Discovered a historical catalogue event",
                metadata={"event_id": discovery.event_id},
            )
        return Response(
            {"event_id": discovery.event_id, "discovered_at": discovery.discovered_at, "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class BookmarkListView(AuthenticatedView):
    def get(self, request):
        items = Bookmark.objects.filter(owner=request.user)
        return Response(BookmarkSerializer(items, many=True).data)

    def post(self, request):
        serializer = BookmarkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item, created = Bookmark.objects.get_or_create(
            owner=request.user,
            item_type=serializer.validated_data["item_type"],
            item_id=serializer.validated_data["item_id"],
            defaults={"title": serializer.validated_data["title"]},
        )
        if not created and item.title != serializer.validated_data["title"]:
            item.title = serializer.validated_data["title"]
            item.save(update_fields=["title"])
        return Response(BookmarkSerializer(item).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class BookmarkDetailView(AuthenticatedView):
    def delete(self, request, pk):
        try:
            Bookmark.objects.get(pk=pk, owner=request.user).delete()
        except Bookmark.DoesNotExist as error:
            from rest_framework.exceptions import NotFound

            raise NotFound("Bookmark not found.") from error
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProgressSummaryView(AuthenticatedView):
    def get(self, request):
        saves = GameSave.objects.filter(owner=request.user)
        progress = CampaignProgress.objects.filter(owner=request.user)
        decisions_by_campaign = {}
        for campaign_id, state in saves.values_list("campaign_id", "game_state"):
            choices = state.get("choices", []) if isinstance(state, dict) else []
            if isinstance(choices, list):
                decisions_by_campaign[campaign_id] = max(
                    decisions_by_campaign.get(campaign_id, 0), len(choices)
                )
        decisions = sum(decisions_by_campaign.values())
        achievements = UserAchievement.objects.filter(owner=request.user).count()
        recent_activity = UserActivity.objects.filter(owner=request.user)[:10]
        return Response(
            {
                "stats": {
                    "campaignsStarted": progress.count(),
                    "campaignsCompleted": progress.filter(status=CampaignProgress.Status.COMPLETED).count(),
                    "eventsDiscovered": EventDiscovery.objects.filter(owner=request.user).count(),
                    "achievementsUnlocked": achievements,
                    "decisionsMade": decisions,
                    "completionPercentage": round(
                        progress.filter(status=CampaignProgress.Status.COMPLETED).count() / progress.count() * 100
                    ) if progress.exists() else 0,
                    "savedScenarios": saves.exclude(scenario_id="").values("scenario_id").distinct().count(),
                    "bookmarks": Bookmark.objects.filter(owner=request.user).count(),
                },
                "campaigns": CampaignProgressSerializer(progress, many=True).data,
                "achievements": UserAchievementSerializer(
                    UserAchievement.objects.filter(owner=request.user).select_related("achievement"), many=True
                ).data,
                "activity": UserActivitySerializer(recent_activity, many=True).data,
                "saves": GameSaveSerializer(saves, many=True).data,
                "bookmarks": BookmarkSerializer(Bookmark.objects.filter(owner=request.user), many=True).data,
            }
        )


class CampaignProgressListView(AuthenticatedView):
    def get(self, request):
        progress = CampaignProgress.objects.filter(owner=request.user)
        return Response(CampaignProgressSerializer(progress, many=True).data)


class AchievementListView(AuthenticatedView):
    def get(self, request):
        achievements = UserAchievement.objects.filter(owner=request.user).select_related("achievement")
        return Response(UserAchievementSerializer(achievements, many=True).data)


class ActivityListView(AuthenticatedView):
    def get(self, request):
        activity = UserActivity.objects.filter(owner=request.user)[:50]
        return Response(UserActivitySerializer(activity, many=True).data)


def award_first_save(user):
    definition, _ = Achievement.objects.get_or_create(
        slug="first-save",
        defaults={
            "name": "First Chronicle",
            "description": "Create your first persistent game save.",
            "criteria": "Awarded after the first save is confirmed in the database.",
        },
    )
    UserAchievement.objects.get_or_create(owner=user, achievement=definition)
