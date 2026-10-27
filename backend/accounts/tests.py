import json

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.core import mail
from django.test import Client, TestCase, override_settings
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from progress.models import Bookmark, CampaignProgress, EventDiscovery, GameSave, UserAchievement


User = get_user_model()
PASSWORD = "S!mulation-Passphrase-742"


def save_payload(name="First save", campaign_id="emergency", game_state=None):
    return {
        "name": name,
        "campaign_id": campaign_id,
        "scenario_id": campaign_id,
        "faction": "Indira Gandhi",
        "turn": 1,
        "game_date": "25 JUN 1975",
        "game_state": game_state or {
            "node": 1,
            "state": {"stability": 52, "trust": 50, "liberties": 43, "legitimacy": 49},
            "choices": [{"choice": "censor"}],
            "entries": [{"date": "26 JUN 1975", "text": "Decision", "kind": "hypothetical"}],
        },
        "format_version": 1,
    }


@override_settings(
    REST_FRAMEWORK={
        "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
        "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
        "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
        "DEFAULT_THROTTLE_RATES": {
            "auth-register": "1000/hour",
            "auth-login": "1000/hour",
            "auth-password-reset": "1000/hour",
        },
    }
)
class AccountApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def register(self, username="player", email="player@example.com"):
        return self.client.post(
            "/api/auth/register/",
            {
                "username": username,
                "email": email,
                "password": PASSWORD,
                "confirm_password": PASSWORD,
            },
            format="json",
        )

    def test_registration_hashes_password_and_authenticates_the_session(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username="player")
        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(user.password.startswith("argon2$"))
        self.assertTrue(user.check_password(PASSWORD))
        self.assertEqual(response.data["username"], "player")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

    def test_health_check_reports_database_without_exposing_connection_details(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "healthy", "ok": True, "database": "healthy"})

    def test_duplicate_usernames_and_case_insensitive_emails_are_rejected(self):
        self.assertEqual(self.register().status_code, 201)
        duplicate_username = self.register(email="other@example.com")
        self.assertEqual(duplicate_username.status_code, 400)
        duplicate_email = self.register(username="another", email="PLAYER@EXAMPLE.COM")
        self.assertEqual(duplicate_email.status_code, 400)
        self.assertEqual(User.objects.count(), 1)

    def test_mismatched_and_weak_passwords_are_rejected(self):
        mismatch = self.client.post(
            "/api/auth/register/",
            {
                "username": "player",
                "email": "player@example.com",
                "password": PASSWORD,
                "confirm_password": "different",
            },
            format="json",
        )
        weak = self.client.post(
            "/api/auth/register/",
            {
                "username": "player",
                "email": "player@example.com",
                "password": "short",
                "confirm_password": "short",
            },
            format="json",
        )
        self.assertEqual(mismatch.status_code, 400)
        self.assertIn("confirm_password", mismatch.data)
        self.assertEqual(weak.status_code, 400)
        self.assertIn("password", weak.data)

    def test_login_accepts_email_and_logout_clears_the_session(self):
        self.register()
        self.client.post("/api/auth/logout/", {}, format="json")
        login = self.client.post(
            "/api/auth/login/",
            {"username_or_email": "PLAYER@example.com", "password": PASSWORD},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.data["username"], "player")
        self.assertEqual(self.client.post("/api/auth/logout/", {}, format="json").status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 403)

    def test_login_failure_has_a_generic_message(self):
        self.register()
        response = self.client.post(
            "/api/auth/login/",
            {"username_or_email": "player", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data["detail"][0],
            "The username/email or password is incorrect.",
        )

    def test_anonymous_users_cannot_read_private_progress_or_saves(self):
        for path in ("/api/auth/me/", "/api/profile/", "/api/saves/", "/api/progress/"):
            self.assertIn(self.client.get(path).status_code, (401, 403), path)

    def test_account_mutations_require_csrf_for_browser_sessions(self):
        client = Client(enforce_csrf_checks=True)
        csrf = client.get("/api/auth/csrf/")
        self.assertEqual(csrf.status_code, 200)
        body = {
            "username": "csrf-player",
            "email": "csrf@example.com",
            "password": PASSWORD,
            "confirm_password": PASSWORD,
        }
        rejected = client.post("/api/auth/register/", json.dumps(body), content_type="application/json")
        accepted = client.post(
            "/api/auth/register/",
            json.dumps(body),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf.json()["csrfToken"],
        )
        self.assertEqual(rejected.status_code, 403)
        self.assertIn("CSRF verification failed", rejected.json()["detail"])
        self.assertEqual(accepted.status_code, 201)

    def test_password_reset_response_does_not_disclose_account_existence(self):
        User.objects.create_user(username="player", email="player@example.com", password=PASSWORD)
        known = self.client.post(
            "/api/auth/password-reset/",
            {"email": "player@example.com"},
            format="json",
        )
        unknown = self.client.post(
            "/api/auth/password-reset/",
            {"email": "missing@example.com"},
            format="json",
        )
        self.assertEqual(known.status_code, 200)
        self.assertEqual(known.data, unknown.data)
        self.assertIn("when email delivery is configured", known.data["detail"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("http://localhost:3000/?uid=", mail.outbox[0].body)

    def test_password_reset_confirmation_rejects_bad_tokens_and_updates_password(self):
        user = User.objects.create_user(username="reset-player", email="reset@example.com", password=PASSWORD)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        invalid = self.client.post(
            "/api/auth/password-reset/confirm/",
            {
                "uid": uid,
                "token": "invalid-token",
                "new_password": "N3w!Secure-Passphrase-907",
                "confirm_password": "N3w!Secure-Passphrase-907",
            },
            format="json",
        )
        mismatch = self.client.post(
            "/api/auth/password-reset/confirm/",
            {
                "uid": uid,
                "token": token,
                "new_password": "N3w!Secure-Passphrase-907",
                "confirm_password": "not-the-same",
            },
            format="json",
        )
        accepted = self.client.post(
            "/api/auth/password-reset/confirm/",
            {
                "uid": uid,
                "token": token,
                "new_password": "N3w!Secure-Passphrase-907",
                "confirm_password": "N3w!Secure-Passphrase-907",
            },
            format="json",
        )
        user.refresh_from_db()
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(mismatch.status_code, 400)
        self.assertEqual(accepted.status_code, 200)
        self.assertTrue(user.check_password("N3w!Secure-Passphrase-907"))


class GameProgressApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", email="owner@example.com", password=PASSWORD)
        self.other = User.objects.create_user(username="other", email="other@example.com", password=PASSWORD)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def test_create_resume_update_and_delete_save_and_update_progress(self):
        response = self.client.post("/api/saves/", save_payload(), format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["revision"], 1)
        save_id = response.data["id"]
        campaign = CampaignProgress.objects.get(owner=self.owner)
        self.assertEqual(campaign.status, "in_progress")
        self.assertEqual(str(campaign.last_save_id), save_id)
        self.assertTrue(UserAchievement.objects.filter(owner=self.owner, achievement__slug="first-save").exists())

        updated_state = save_payload(game_state={
            "node": 3,
            "ended": True,
            "state": {"stability": 51, "trust": 68, "liberties": 70, "legitimacy": 74},
            "choices": [
                {"node": "opening", "choice": "guardrails"},
                {"node": "press", "choice": "limited"},
                {"node": "election", "choice": "election"},
            ],
            "entries": [],
        })
        patch = self.client.patch(
            f"/api/saves/{save_id}/",
            {**updated_state, "expected_revision": 1},
            format="json",
        )
        self.assertEqual(patch.status_code, 200)
        self.assertEqual(patch.data["revision"], 2)
        self.assertEqual(CampaignProgress.objects.get(owner=self.owner).status, "completed")

        resume = self.client.post(f"/api/saves/{save_id}/resume/", {}, format="json")
        self.assertEqual(resume.status_code, 200)
        self.assertEqual(self.client.get("/api/saves/").data[0]["id"], save_id)
        summary = self.client.get("/api/progress/").data
        self.assertEqual(summary["stats"]["decisionsMade"], 3)
        self.assertEqual(summary["stats"]["completionPercentage"], 100)
        self.assertEqual(summary["stats"]["savedScenarios"], 1)
        self.assertEqual(self.client.delete(f"/api/saves/{save_id}/").status_code, 204)
        self.assertFalse(GameSave.objects.filter(owner=self.owner).exists())

    def test_save_ownership_applies_to_list_read_update_resume_and_delete(self):
        save = self.client.post("/api/saves/", save_payload(), format="json").data
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/saves/").data, [])
        self.assertEqual(self.client.get(f"/api/saves/{save['id']}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/saves/{save['id']}/resume/", {}, format="json").status_code, 404)
        self.assertEqual(
            self.client.patch(
                f"/api/saves/{save['id']}/",
                {"name": "stolen", "expected_revision": 1},
                format="json",
            ).status_code,
            404,
        )
        self.assertEqual(self.client.delete(f"/api/saves/{save['id']}/").status_code, 404)
        self.assertEqual(GameSave.objects.get().owner, self.owner)

    def test_bookmarks_are_persistent_and_scoped_to_the_authenticated_owner(self):
        created = self.client.post(
            "/api/bookmarks/",
            {"item_type": "scenario", "item_id": "emergency", "title": "The Emergency"},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        bookmark_id = created.data["id"]
        duplicate = self.client.post(
            "/api/bookmarks/",
            {"item_type": "scenario", "item_id": "emergency", "title": "The Emergency"},
            format="json",
        )
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(Bookmark.objects.filter(owner=self.owner).count(), 1)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/bookmarks/").data, [])
        self.assertEqual(self.client.delete(f"/api/bookmarks/{bookmark_id}/").status_code, 404)

    def test_stale_save_revision_is_rejected_without_overwriting_data(self):
        save = self.client.post("/api/saves/", save_payload(), format="json").data
        changed = self.client.patch(
            f"/api/saves/{save['id']}/",
            {"name": "updated", "expected_revision": 1},
            format="json",
        )
        stale = self.client.patch(
            f"/api/saves/{save['id']}/",
            {"name": "stale overwrite", "expected_revision": 1},
            format="json",
        )
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(GameSave.objects.get().name, "updated")

    def test_invalid_save_version_and_oversized_state_are_rejected(self):
        unsupported = save_payload()
        unsupported["format_version"] = 2
        self.assertEqual(self.client.post("/api/saves/", unsupported, format="json").status_code, 400)
        oversized = save_payload(game_state={"blob": "x" * 1_000_001})
        self.assertEqual(self.client.post("/api/saves/", oversized, format="json").status_code, 400)

    def test_client_cannot_claim_campaign_completion_with_fabricated_state(self):
        payload = save_payload(game_state={
            "node": 3,
            "ended": True,
            "state": {"stability": 100, "trust": 100, "liberties": 100, "legitimacy": 100},
            "choices": [
                {"node": "opening", "choice": "fabricated"},
                {"node": "press", "choice": "fabricated"},
                {"node": "election", "choice": "fabricated"},
            ],
        })
        self.client.post("/api/saves/", payload, format="json")
        self.assertEqual(CampaignProgress.objects.get(owner=self.owner).status, "in_progress")

    def test_event_discovery_is_catalog_validated_and_idempotent(self):
        first = self.client.post(
            "/api/progress/events/discover/", {"event_id": "emergency"}, format="json"
        )
        repeated = self.client.post(
            "/api/progress/events/discover/", {"event_id": "emergency"}, format="json"
        )
        invalid = self.client.post(
            "/api/progress/events/discover/", {"event_id": "not-a-catalogue-event"}, format="json"
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(repeated.status_code, 200)
        self.assertFalse(repeated.data["created"])
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(EventDiscovery.objects.filter(owner=self.owner).count(), 1)

    def test_user_activity_and_achievements_are_only_returned_to_the_owner(self):
        self.client.post("/api/saves/", save_payload(), format="json")
        summary = self.client.get("/api/progress/")
        self.assertEqual(summary.data["stats"]["achievementsUnlocked"], 1)
        self.assertEqual(summary.data["achievements"][0]["slug"], "first-save")
        self.assertEqual(summary.data["activity"][0]["activity_type"], "game_saved")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/progress/achievements/").data, [])
        self.assertEqual(self.client.get("/api/progress/activity/").data, [])
