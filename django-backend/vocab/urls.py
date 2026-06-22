from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import LanguageViewSet, VideoViewSet, RegisterView, ObtainTokenView, ProfileAPIView, WatchSessionView

router = DefaultRouter()
router.register("languages", LanguageViewSet, basename="language")
router.register("videos", VideoViewSet, basename="video")

urlpatterns = router.urls + [
    path("auth/register/", RegisterView.as_view(), name="api-register"),
    path("auth/token/", ObtainTokenView.as_view(), name="api-token"),
    path("profile/", ProfileAPIView.as_view(), name="api-profile"),
    path("watch/", WatchSessionView.as_view(), name="api-watch"),
]
