from django.contrib import admin
from django.urls import include, path
from .api_errors import health


urlpatterns = [
    path("health", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("progress.urls")),
]

handler404 = "config.api_errors.api_not_found"
handler500 = "config.api_errors.api_server_error"
