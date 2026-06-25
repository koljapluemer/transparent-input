from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from ..models import Video, VideoTranslation
from ..serializers import (
    VideoListSerializer,
    VideoDetailSerializer,
    VideoTranslationDetailSerializer,
)


class VideoViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Video.objects.all()
    lookup_field = "youtube_id"

    def get_serializer_class(self):
        if self.action == "retrieve":
            return VideoDetailSerializer
        return VideoListSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        language = self.request.query_params.get("language")
        if language:
            qs = qs.filter(language=language)
        return qs

    @action(detail=True, methods=["post"], url_path="translations")
    def store_translation(self, request, youtube_id=None):
        pipeline = request.data.get("pipeline")
        native_language = request.data.get("native_language")
        level = request.data.get("level", VideoTranslation.Level.INTERMEDIATE)
        segments = request.data.get("segments")
        language = request.data.get("language") or None
        title = request.data.get("title") or None

        if not pipeline or not native_language or not isinstance(segments, list):
            return Response(
                {"error": "pipeline, native_language, and segments (list) are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if level not in VideoTranslation.Level.values:
            return Response(
                {"error": f"level must be one of: {', '.join(VideoTranslation.Level.values)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        video, _ = Video.objects.get_or_create(
            youtube_id=youtube_id,
            defaults={"language": language, "topics": None, "title": title},
        )
        if title and not video.title:
            video.title = title
            video.save(update_fields=["title"])

        _, created = VideoTranslation.objects.update_or_create(
            video=video,
            pipeline=pipeline,
            native_language=native_language,
            level=level,
            defaults={"segments": segments},
        )

        return Response(
            {"status": "stored" if created else "updated"},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["get"],
        url_path=r"translations/(?P<native_language>[^/.]+)",
    )
    def translation_detail(self, request, youtube_id=None, native_language=None):
        video = self.get_object()
        level = request.query_params.get("level", VideoTranslation.Level.INTERMEDIATE)

        translation = (
            VideoTranslation.objects.filter(
                video=video,
                native_language=native_language,
                level=level,
            )
            .order_by("-created_at")
            .first()
        )

        if translation is None:
            return Response(
                {"error": f"No translation found for language: {native_language}, level: {level}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(VideoTranslationDetailSerializer(translation).data)
