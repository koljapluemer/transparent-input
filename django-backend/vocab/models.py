from django.db import models


class Language(models.Model):
    iso3 = models.CharField(max_length=10, primary_key=True)
    subtitle_language = models.CharField(max_length=10)
    human_readable = models.CharField(max_length=100)

    def __str__(self):
        return self.human_readable


class Video(models.Model):
    youtube_id = models.CharField(max_length=20, unique=True)
    language = models.ForeignKey(Language, on_delete=models.CASCADE, related_name="videos")
    segments = models.JSONField(default=list)
    topics = models.JSONField(null=True, blank=True)

    def __str__(self):
        return self.youtube_id


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
