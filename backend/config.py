from __future__ import annotations
import json
import logging
import os

logger = logging.getLogger(__name__)

# Populated at startup by load()
mapbox_token: str = ''


def load() -> None:
    """Read config from AWS Secrets Manager. Falls back to env vars."""
    global mapbox_token

    # Env var override (local dev)
    if os.environ.get('MAPBOX_TOKEN'):
        mapbox_token = os.environ['MAPBOX_TOKEN']
        logger.info('Mapbox token loaded from environment')
        return

    try:
        import boto3
        client = boto3.client('secretsmanager', region_name='us-east-1')
        secret = client.get_secret_value(SecretId='subway-intel/mapbox-token')
        mapbox_token = json.loads(secret['SecretString'])['token']
        logger.info('Mapbox token loaded from Secrets Manager')
    except Exception as e:
        logger.warning('Could not load Mapbox token from Secrets Manager: %s', e)
