from django.urls import path

from .views.home import LandingView, LanguageSelectView
from .views.request_video import RequestVideoView
from .views.videos import VideoListView, VideoPlayerView

urlpatterns = [
    path("", LandingView.as_view(), name="landing"),
    path("languages/", LanguageSelectView.as_view(), name="language-select"),
    path("videos/<str:language>/", VideoListView.as_view(), name="video-list"),
    path("videos/<str:language>/request/", RequestVideoView.as_view(), name="request-video"),
    path("videos/<str:language>/<str:youtube_id>/", VideoPlayerView.as_view(), name="video-player"),
]
