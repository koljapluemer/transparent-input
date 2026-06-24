from django.contrib import admin

from .models import Language, Video, VideoTranslation

admin.site.register(Language)
admin.site.register(Video)
admin.site.register(VideoTranslation)
