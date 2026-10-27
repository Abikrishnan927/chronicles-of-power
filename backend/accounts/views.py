from django.contrib.auth import login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import permissions, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Profile
from .serializers import (
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    RegistrationSerializer,
)


@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def csrf_token(request):
    return Response({"csrfToken": get_token(request)})


class CsrfProtectedView(APIView):
    authentication_classes = [SessionAuthentication]


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(CsrfProtectedView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = "auth-register"

    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(user_payload(user), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(CsrfProtectedView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = "auth-login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        login(request, user)
        return Response(user_payload(user))


class LogoutView(CsrfProtectedView):
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CurrentUserView(CsrfProtectedView):
    def get(self, request):
        return Response(user_payload(request.user))


class ProfileView(CsrfProtectedView):
    def get(self, request):
        profile, _ = Profile.objects.get_or_create(user=request.user)
        return Response(ProfileSerializer(profile).data)

    def patch(self, request):
        profile, _ = Profile.objects.get_or_create(user=request.user)
        serializer = ProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetRequestView(CsrfProtectedView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = "auth-password-reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {"detail": "If an account matches that email, reset instructions will be sent when email delivery is configured."}
        )


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetConfirmView(CsrfProtectedView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Password updated. You can now sign in."})


def user_payload(user):
    profile, _ = Profile.objects.get_or_create(user=user)
    return {
        "id": user.pk,
        "username": user.username,
        "email": user.email,
        "displayName": profile.display_name or user.username,
        "createdAt": user.created_at,
        "lastActiveAt": profile.last_active_at,
    }
