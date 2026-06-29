from django.urls import path

from .views.home import LandingView, LanguageSelectView
from .views.videos import VideoListView

urlpatterns = [
    path("", LandingView.as_view(), name="landing"),
    path("languages/", LanguageSelectView.as_view(), name="language-select"),
    path("videos/<str:language>/", VideoListView.as_view(), name="video-list"),
]
