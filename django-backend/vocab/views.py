from rest_framework import viewsets, mixins
from rest_framework.response import Response
from .models import Language, Video
from .serializers import LanguageSerializer, VideoListSerializer, VideoDetailSerializer


class LanguageViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = Language.objects.all()
    serializer_class = LanguageSerializer


class VideoViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Video.objects.select_related("language").all()
    lookup_field = "youtube_id"

    def get_serializer_class(self):
        if self.action == "retrieve":
            return VideoDetailSerializer
        return VideoListSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        language = self.request.query_params.get("language")
        if language:
            qs = qs.filter(language_id=language)
        return qs
