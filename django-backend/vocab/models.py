from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class EmailUserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email address is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra_fields)


class User(AbstractUser):
    username = None
    email = models.EmailField(unique=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = EmailUserManager()

    def __str__(self):
        return self.email


class Language(models.Model):
    iso3 = models.CharField(max_length=10, primary_key=True)
    subtitle_language = models.CharField(max_length=10)
    human_readable = models.CharField(max_length=100)

    def __str__(self):
        return self.human_readable


class Video(models.Model):
    youtube_id = models.CharField(max_length=20, unique=True)
    title = models.CharField(max_length=500, null=True, blank=True)
    language = models.ForeignKey(Language, on_delete=models.CASCADE, related_name="videos")
    segments = models.JSONField(default=list)
    topics = models.JSONField(null=True, blank=True)

    def __str__(self):
        return self.title or self.youtube_id


class VideoTranslation(models.Model):
    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name="translations")
    pipeline = models.CharField(max_length=50)
    native_language = models.CharField(max_length=10)
    segments = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("video", "pipeline", "native_language")]

    def __str__(self):
        return f"{self.video.youtube_id} — {self.pipeline} — {self.target_language}"


class ProcessingJob(models.Model):
    STATUS = [
        ("pending", "Pending"),
        ("running", "Running"),
        ("done", "Done"),
        ("failed", "Failed"),
        ("partial", "Partial"),
    ]
    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name="jobs")
    pipeline = models.CharField(max_length=50)
    status = models.CharField(max_length=10, choices=STATUS, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)
    raw_transcript = models.JSONField()

    def __str__(self):
        return f"{self.video.youtube_id} — {self.pipeline} — {self.status}"


class Like(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="likes")
    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name="likes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "video")]

    def __str__(self):
        return f"{self.user} likes {self.video}"


class WatchSession(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="watch_sessions")
    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name="watch_sessions")
    seconds_watched = models.PositiveIntegerField(default=0)
    date = models.DateField()

    class Meta:
        unique_together = [("user", "video", "date")]

    def __str__(self):
        return f"{self.user} watched {self.video} for {self.seconds_watched}s on {self.date}"
