import logging

from django.http import JsonResponse
from django.db import connection
from django.views.decorators.http import require_GET
from django.views.csrf import csrf_failure as default_csrf_failure
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


logger = logging.getLogger("django.request")


@require_GET
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return JsonResponse({"status": "healthy", "ok": True, "database": "healthy"})
    except Exception:
        logger.exception("Account database health check failed.")
        return JsonResponse({"status": "unavailable", "ok": False, "database": "unavailable"}, status=503)


def api_exception_handler(exception, context):
    response = exception_handler(exception, context)
    if response is not None:
        return response
    logger.error(
        "Unhandled exception in the account API.",
        exc_info=(type(exception), exception, exception.__traceback__),
    )
    return Response(
        {"detail": "The account service could not complete the request."},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


def csrf_failure(request, reason=""):
    if request.path.startswith("/api/"):
        return JsonResponse(
            {"detail": "CSRF verification failed. Refresh the page and try again."},
            status=403,
        )
    return default_csrf_failure(request, reason=reason)


def api_not_found(request, exception):
    if request.path.startswith("/api/"):
        return JsonResponse({"detail": "API endpoint not found."}, status=404)
    from django.views.defaults import page_not_found

    return page_not_found(request, exception)


def api_server_error(request):
    if request.path.startswith("/api/"):
        return JsonResponse(
            {"detail": "The account service could not complete the request."},
            status=500,
        )
    from django.views.defaults import server_error

    return server_error(request)
