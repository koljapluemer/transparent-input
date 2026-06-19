from rest_framework import serializers
from .models import Language, Video, ProcessingJob


class LanguageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Language
        fields = ["iso3", "subtitle_language", "human_readable"]


class VideoListSerializer(serializers.ModelSerializer):
    language = LanguageSerializer(read_only=True)

    class Meta:
        model = Video
        fields = ["youtube_id", "language"]


class ProcessingJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProcessingJob
        fields = ["id", "pipeline", "status", "created_at"]


class VideoDetailSerializer(serializers.ModelSerializer):
    language = LanguageSerializer(read_only=True)
    processing = serializers.SerializerMethodField()

    class Meta:
        model = Video
        fields = ["youtube_id", "language", "segments", "topics", "processing"]

    def get_processing(self, obj):
        job = obj.jobs.order_by('-created_at').first()
        if not job:
            return None
        return ProcessingJobSerializer(job).data
