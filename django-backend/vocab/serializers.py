from rest_framework import serializers
from .models import Language, Video, VideoTranslation


class LanguageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Language
        fields = ["iso3", "subtitle_language", "human_readable"]


class VideoListSerializer(serializers.ModelSerializer):
    language = LanguageSerializer(read_only=True)

    class Meta:
        model = Video
        fields = ["youtube_id", "title", "language"]


class VideoTranslationSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = VideoTranslation
        fields = ["pipeline", "native_language", "created_at"]


class VideoTranslationDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = VideoTranslation
        fields = ["pipeline", "native_language", "segments"]


class VideoDetailSerializer(serializers.ModelSerializer):
    language = LanguageSerializer(read_only=True)
    available_translations = serializers.SerializerMethodField()

    class Meta:
        model = Video
        fields = ["youtube_id", "title", "language", "topics", "available_translations"]

    def get_available_translations(self, obj):
        return VideoTranslationSummarySerializer(
            obj.translations.order_by('-created_at'),
            many=True,
        ).data
