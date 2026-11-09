import boto3
from botocore.config import Config

from app.config import settings


def storage_client():
    if not settings.storage_configured:
        return None
    return boto3.client(
        "s3",
        endpoint_url=settings.aws_endpoint_url_s3,
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    )
