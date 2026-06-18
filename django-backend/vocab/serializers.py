from rest_framework import serializers
from .models import Language, Video


class LanguageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Language
        fields = ["iso3", "subtitle_language", "human_readable"]


class VideoListSerializer(serializers.ModelSerializer):
    language = LanguageSerializer(read_only=True)

    class Meta:
        model = Video
        fields = ["youtube_id", "language"]


class VideoDetailSerializer(serializers.ModelSerializer):
    language = LanguageSerializer(read_only=True)

    class Meta:
        model = Video
        fields = ["youtube_id", "language", "segments", "topics"]
