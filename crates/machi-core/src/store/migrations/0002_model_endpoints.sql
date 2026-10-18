-- Endpoint types each model supports (from GET /models `supported_endpoint_types`), as a JSON array.
ALTER TABLE model_cache ADD COLUMN endpoint_types TEXT NOT NULL DEFAULT '[]';
