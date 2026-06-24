from django.db import models


class Language(models.Model):
    iso3 = models.CharField(max_length=10, primary_key=True)
    subtitle_language = models.CharField(max_length=10)
    human_readable = models.CharField(max_length=100)

    def __str__(self):
        return self.human_readable


class Video(models.Model):
    youtube_id = models.CharField(max_length=20, unique=True)
    title = models.CharField(max_length=500, null=True, blank=True)
    language = models.ForeignKey(Language, on_delete=models.SET_NULL, null=True, blank=True, related_name="videos")
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
        return f"{self.video.youtube_id} — {self.pipeline} — {self.native_language}"


