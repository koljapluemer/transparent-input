from .italian import ItalianPipeline
from .vietnamese import VietnamesePipeline

_REGISTRY: dict = {
    ItalianPipeline.name: ItalianPipeline(),
    VietnamesePipeline.name: VietnamesePipeline(),
}

# Map language iso3 → pipeline name
_LANGUAGE_MAP: dict[str, str] = {
    "ita": ItalianPipeline.name,
    "vie": VietnamesePipeline.name,
}


def get_pipeline_for_language(pipeline_name: str):
    """Look up a pipeline instance by its name (as stored on ProcessingJob.pipeline)."""
    if pipeline_name not in _REGISTRY:
        raise KeyError(f"No pipeline registered: {pipeline_name!r}")
    return _REGISTRY[pipeline_name]


def get_pipeline_name_for_iso3(iso3: str) -> str:
    """Return the pipeline name for a given language iso3 code, or raise KeyError."""
    if iso3 not in _LANGUAGE_MAP:
        raise KeyError(f"No pipeline configured for language: {iso3!r}")
    return _LANGUAGE_MAP[iso3]
