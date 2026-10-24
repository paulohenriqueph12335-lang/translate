-- Token independente de precisão de data: tentativas abandonadas não alteram a tentativa que as substituiu.
ALTER TABLE documents ADD COLUMN upload_attempt_id uuid;
