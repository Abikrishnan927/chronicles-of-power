import json
import logging
import time
import uuid
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone


request_logger = logging.getLogger("django.request")


class StructuredRequestLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = str(uuid.uuid4())
        started = time.monotonic()
        response = self.get_response(request)
        response["X-Request-Id"] = request.request_id
        request_logger.info(json.dumps({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "requestId": request.request_id,
            "method": request.method,
            "path": request.path,
            "status": response.status_code,
            "durationMs": round((time.monotonic() - started) * 1000),
        }))
        return response


class LastActiveMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        if request.path.startswith("/api/") and user is not None and user.is_authenticated:
            now = timezone.now()
            try:
                from accounts.models import Profile

                Profile.objects.filter(user_id=user.pk).filter(
                    Q(last_active_at__isnull=True) | Q(last_active_at__lt=now - timedelta(minutes=5))
                ).update(last_active_at=now)
            except Exception:
                logging.getLogger("django.request").warning("Account last-active update failed.")
        return self.get_response(request)
