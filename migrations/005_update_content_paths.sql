UPDATE sites
SET html = replace(
  replace(
    replace(
      replace(html, '"/content/', '"/' || user_id || '/' || id || '/content/'),
      '''/content/', '''/' || user_id || '/' || id || '/content/'
    ),
    '(/content/', '(/' || user_id || '/' || id || '/content/'
  ),
  './content/', '/' || user_id || '/' || id || '/content/'
);
