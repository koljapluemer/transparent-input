from rest_framework.routers import DefaultRouter

from .views import LanguageViewSet, VideoViewSet

router = DefaultRouter()
router.register("languages", LanguageViewSet, basename="language")
router.register("videos", VideoViewSet, basename="video")

urlpatterns = router.urls
