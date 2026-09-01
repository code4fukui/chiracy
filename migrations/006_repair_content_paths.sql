UPDATE sites
SET html = replace(
  replace(
    html,
    '/' || user_id || '/' || id || '/' || user_id || '/' || id || '/content/',
    '/' || user_id || '/' || id || '/content/'
  ),
  './' || user_id || '/' || id || '/content/',
  '/' || user_id || '/' || id || '/content/'
);
