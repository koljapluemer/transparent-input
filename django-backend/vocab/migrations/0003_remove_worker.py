from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('vocab', '0002_remove_accounts'),
    ]

    operations = [
        migrations.DeleteModel('ProcessingJob'),
        migrations.RemoveField(model_name='video', name='segments'),
        migrations.AlterField(
            model_name='video',
            name='language',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='videos',
                to='vocab.language',
            ),
        ),
    ]
