from django.urls import path

from accounts.views import ProfileView
from .views import (
    AchievementListView,
    ActivityListView,
    BookmarkDetailView,
    BookmarkListView,
    CampaignProgressListView,
    EventDiscoveryView,
    ProgressSummaryView,
    ResumeSaveView,
    SaveDetailView,
    SaveListView,
)


urlpatterns = [
    path("profile/", ProfileView.as_view(), name="profile"),
    path("saves/", SaveListView.as_view(), name="save-list"),
    path("saves/<uuid:pk>/", SaveDetailView.as_view(), name="save-detail"),
    path("saves/<uuid:pk>/resume/", ResumeSaveView.as_view(), name="save-resume"),
    path("bookmarks/", BookmarkListView.as_view(), name="bookmark-list"),
    path("bookmarks/<int:pk>/", BookmarkDetailView.as_view(), name="bookmark-detail"),
    path("progress/", ProgressSummaryView.as_view(), name="progress-summary"),
    path("progress/campaigns/", CampaignProgressListView.as_view(), name="campaign-progress"),
    path("progress/achievements/", AchievementListView.as_view(), name="achievement-list"),
    path("progress/activity/", ActivityListView.as_view(), name="activity-list"),
    path("progress/events/discover/", EventDiscoveryView.as_view(), name="event-discovery"),
]
