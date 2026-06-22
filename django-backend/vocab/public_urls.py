from django.contrib.auth import views as auth_views
from django.urls import path

from .views.home import HomeView, RegisterPageView, ProfilePageView
from .views.videos import VideoListView

urlpatterns = [
    path("", HomeView.as_view(), name="home"),
    path("videos/<str:iso3>/", VideoListView.as_view(), name="video-list"),
    path("register/", RegisterPageView.as_view(), name="register"),
    path("login/", auth_views.LoginView.as_view(template_name="vocab/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("profile/", ProfilePageView.as_view(), name="profile"),
]
