from django.db import models


class Video(models.Model):
    youtube_id = models.CharField(max_length=20, unique=True)
    title = models.CharField(max_length=500, null=True, blank=True)
    language = models.CharField(max_length=20, null=True, blank=True)
    topics = models.JSONField(null=True, blank=True)

    def __str__(self):
        return self.title or self.youtube_id


class VideoTranslation(models.Model):
    class Level(models.TextChoices):
        BEGINNER = "BEGINNER"
        INTERMEDIATE = "INTERMEDIATE"
        EXPERT = "EXPERT"

    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name="translations")
    pipeline = models.CharField(max_length=50)
    native_language = models.CharField(max_length=10)
    level = models.CharField(max_length=20, choices=Level.choices, default=Level.INTERMEDIATE)
    checked_by_human = models.BooleanField(default=False)
    segments = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("video", "pipeline", "native_language", "level")]

    def __str__(self):
        return f"{self.video.youtube_id} — {self.pipeline} — {self.native_language} — {self.level}"
