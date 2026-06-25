from rest_framework import serializers
from .models import Video, VideoTranslation


class VideoListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Video
        fields = ["youtube_id", "title", "language"]


class VideoTranslationSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = VideoTranslation
        fields = ["pipeline", "native_language", "level", "created_at"]


class VideoTranslationDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = VideoTranslation
        fields = ["pipeline", "native_language", "level", "segments"]


class VideoDetailSerializer(serializers.ModelSerializer):
    available_translations = serializers.SerializerMethodField()

    class Meta:
        model = Video
        fields = ["youtube_id", "title", "language", "topics", "available_translations"]

    def get_available_translations(self, obj):
        return VideoTranslationSummarySerializer(
            obj.translations.order_by('-created_at'),
            many=True,
        ).data
