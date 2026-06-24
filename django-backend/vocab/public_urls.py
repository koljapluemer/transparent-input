from django.urls import path

from .views.home import HomeView
from .views.videos import VideoListView

urlpatterns = [
    path("", HomeView.as_view(), name="home"),
    path("videos/<str:iso3>/", VideoListView.as_view(), name="video-list"),
]
