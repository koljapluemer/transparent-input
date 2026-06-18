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
    segments = models.JSONField()
    topics = models.JSONField(null=True, blank=True)

    def __str__(self):
        return self.youtube_id
