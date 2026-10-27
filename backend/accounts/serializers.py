from django.contrib.auth import authenticate, get_user_model, password_validation
from django.conf import settings
from django.contrib.auth.forms import PasswordResetForm
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers

from .models import Profile


User = get_user_model()


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ("display_name", "avatar_url", "preferred_theme", "preferences", "last_active_at", "created_at", "updated_at")
        read_only_fields = ("last_active_at", "created_at", "updated_at")

    def validate_preferences(self, value):
        if not isinstance(value, dict) or len(str(value)) > 4000:
            raise serializers.ValidationError("Preferences must be an object no larger than 4 KB.")
        return value


class RegistrationSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_username(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Username cannot be empty.")
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is already in use.")
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        if attrs["password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "The passwords do not match."})
        candidate = User(username=attrs["username"], email=attrs["email"])
        try:
            password_validation.validate_password(attrs["password"], candidate)
        except DjangoValidationError as error:
            raise serializers.ValidationError({"password": list(error.messages)}) from error
        return attrs

    def create(self, validated_data):
        validated_data.pop("confirm_password")
        try:
            with transaction.atomic():
                user = User.objects.create_user(**validated_data)
                Profile.objects.create(user=user)
                return user
        except IntegrityError as error:
            raise serializers.ValidationError(
                {"detail": "That username or email is already registered."}
            ) from error


class LoginSerializer(serializers.Serializer):
    username_or_email = serializers.CharField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        identifier = attrs["username_or_email"].strip()
        user = User.objects.filter(email__iexact=identifier).first()
        username = user.username if user else identifier
        authenticated = authenticate(
            request=self.context.get("request"),
            username=username,
            password=attrs["password"],
        )
        if authenticated is None or not authenticated.is_active:
            raise serializers.ValidationError({"detail": "The username/email or password is incorrect."})
        attrs["user"] = authenticated
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)

    def save(self):
        form = PasswordResetForm({"email": self.validated_data["email"].strip().lower()})
        if not form.is_valid():
            return
        form.save(
            request=self.context.get("request"),
            use_https=self.context.get("request").is_secure(),
            email_template_name="registration/password_reset_email.html",
            subject_template_name="registration/password_reset_subject.txt",
            domain_override=settings.FRONTEND_BASE_URL,
        )


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=128)
    token = serializers.CharField(max_length=256)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "The passwords do not match."})
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_str
        from django.utils.http import urlsafe_base64_decode

        try:
            user_id = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=user_id, is_active=True)
        except (ValueError, TypeError, OverflowError, User.DoesNotExist):
            raise serializers.ValidationError({"detail": "This password-reset link is invalid or expired."})
        if not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError({"detail": "This password-reset link is invalid or expired."})
        try:
            password_validation.validate_password(attrs["new_password"], user)
        except DjangoValidationError as error:
            raise serializers.ValidationError({"new_password": list(error.messages)}) from error
        attrs["user"] = user
        return attrs

    def save(self):
        user = self.validated_data["user"]
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user
