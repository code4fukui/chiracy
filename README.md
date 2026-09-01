# Chiracy チラシィ - かんたんAIチラシ作成、チラシィ

サービス運営：[Code for FUKUI](https://code4fukui.github.io/)

本サービスは[code4fukui/chiracy](https://github.com/code4fukui/chiracy)で
オープンソースとして公開しています。

## 使い方

作成一覧は「企画」「チラシ」「サイト」「アプリ」の順に表示します。
各チャット欄には1回あたり最大10000文字まで入力できます。
作成物は削除アイコンでゴミ箱へ移動し、削除日時とタイトルを確認して復元できます。
ログイン後も左上のロゴから公開トップページへ移動でき、ログイン状態を保ったまま
公開アプリを閲覧できます。
新規ユーザーはレベル1から開始します。企画を1つ作るとレベル2になりチラシが解放され、
チラシを1つ作るとレベル3になりサイトとアプリが解放されます。 新規登録時は
[NANI Terms v1.0](https://github.com/code4fukui/NANI-Terms/blob/main/versions/v1.0/TERMS-ja.md)
への同意が必要です。保存データの永続性や完全性は保証されないため、重要なデータは
利用者自身でバックアップしてください。

### 企画

- 「＋ 新規企画」から、作りたい企画をチャットで伝える
- 右側にMarkdown形式の企画書を表示する
- Markdownのテーブル記法を表として表示する
- 修正点をチャットで伝えると、現在の企画書を維持しながら改善する
- 企画書の末尾に、企画内容を凝縮した「チラシ作成依頼文章」を必ず含める

1. id/pw で新規登録（登録済みであればログイン）
2. 作成済みウェブサイト一覧が並び編集可能。新規ウェブサイトを作成を選択。
3. 2ペインの画面構成（スマホではタブで切り替え）
4. 左側はAIとのチャット形式で指示、右側に完成したウェブサイト
5. まずAIからタイトルを聞かれ、回答したら第一バージョンができる
6. 人が指示すると右側が更新される
7. 公開トグルボタンでURLが発行される （例、 https://[domain]/[user id]/[weubsite
   id] ）
8. 公開トグルボタンで非公開化可能

### チラシ

- 「＋ 新規チラシ」から、作りたいチラシの内容をチャットで伝える
- チラシは標準でA4縦（210mm × 297mm）を前提とする
- 右側に生成されたチラシ画像が表示される
- 修正点をチャットで伝えると、現在の画像をもとに改善される
- 完成したチラシはJPEG形式でダウンロードできる
- チラシ画像とウェブサイトは更新ごとの作成履歴から以前の版へ戻せる
- チラシ履歴は直近5件を日時付きサムネイルで横並び表示する

### アプリ

- 「＋ 新しいアプリ」から、作りたいアプリをチャットで伝える
- シンプルなゲームなど、ブラウザで操作できるアプリを生成する
- CSSとJavaScriptを含む単一HTMLファイルとして保存・表示する
- 外部ライブラリやネットワーク通信なしで動作する
- 修正点をチャットで伝え、作成履歴から以前の版へ戻せる
- 公開したアプリはトップページにサムネイル付きで掲載する

### コンテンツ

- 一覧画面の「マイコンテンツ」で、サイトとアプリに共通して使用する画像、PDF、CSV、音楽などを管理する
- ユーザーによるアップロードも可能（アップロードした時点でどんな画像か、どんなデータかの付加情報を設定）
- JPEG画像は長辺2560pxまたは2MBを超える場合、クライアント側で縮小・再圧縮してからアップロードする
- テキストによる画像生成が可能（生成時のテキストを付加情報として保存しておく）
- テキストによるアップロード済みの画像をベースとして加工済み画像が生成可能
- サイト・アプリ作成時に、ユーザーの全マイコンテンツのURLと付加情報を渡し、ページ内に自動的に埋め込む
- コンテンツのパスは `[user id]/content/[content id]` とする
- マイコンテンツは本人だけが閲覧でき、公開サイト・アプリ内で使われたものだけ外部へ配信する

### JavaScript / WebGL

- スマホでもPCでも見やすいレスポンシブデザイン
- 積極的にJavaScriptやWebGLを使ってリッチな表現（スマホを意識して過度に重くしない）

## 利用制限

- ユーザー毎にポイントが設定される（初期1000ポイント）
- AIチャット、AI画像生成などを使うたびにポイントが減る（API利用料金の倍で円単位で切り上げで減算）

### マイページ

- 画面上部ユーザー名をマイページ表示
- パスワード変更ができる

### 管理者

- ユーザー admin でログインすると管理画面が表示される
- ユーザー毎のポイントを0〜1000000の任意値に変更できる
- 累計使用ポイント、ユーザーレベル、登録日時、最終ログイン日時を確認できる
- ユーザーをBANできる
- 初期ユーザーのポイントを設定できる

## 起動

Deno 2.x が必要です。

```sh
deno task start
```

`.env.example` を `.env` としてコピーし、OpenAI APIキーを設定します。

```sh
cp .env.example .env
```

```env
PORT=8100
OPENAI_API_KEY=sk-...
# 任意（省略時は gpt-5.6-luna）
OPENAI_MODEL=gpt-5.6-luna
# 任意（省略時は gpt-image-2）
OPENAI_IMAGE_MODEL=gpt-image-2
# ポイント計算用（必要に応じて最新値へ変更）
USD_JPY_RATE=150
OPENAI_TEXT_INPUT_USD_PER_MILLION=0.2
OPENAI_TEXT_CACHED_INPUT_USD_PER_MILLION=0.02
OPENAI_TEXT_OUTPUT_USD_PER_MILLION=1.2
OPENAI_IMAGE_COST_USD=0.034
```

`.env` の `PORT` で起動ポートを指定します。上記の例では `http://localhost:8100`
を開いてください。データは `data/chiracy.sqlite` に保存されます。

初期管理者は ID `admin`、パスワード `adminadmin`
です。初回ログイン時にパスワード変更が必要です。

管理者も通常のトップ画面からログインします。管理者としてログインすると、同じURLに
ユーザー管理画面が表示されます。

## 開発

```sh
deno task dev
deno fmt
deno lint
deno check src/server.ts
deno test
```

## Ubuntuへsystemdサービスとしてデプロイ

以下はUbuntu上の `/opt/chiracy` に配置し、専用ユーザー `chiracy` で
常時起動する例です。コマンド中のリポジトリURLは実際のURLへ置き換えてください。

### 1. DenoとGitをインストール

Deno公式のインストールスクリプトを使い、実行ファイルを `/usr/local/bin/deno`
に配置します。

```sh
sudo apt update
sudo apt install -y curl git
curl -fsSL https://deno.land/install.sh | sudo env DENO_INSTALL=/usr/local sh
/usr/local/bin/deno --version
```

UbuntuのaptやSnapで配布されるDenoは最新版より遅れる場合があるため、公式の
インストール方法を推奨します。

### 2. 専用ユーザーを作成して配置

```sh
sudo useradd --system --create-home --home-dir /var/lib/chiracy \
  --shell /usr/sbin/nologin chiracy
sudo git clone https://github.com/code4fukui/chiracy.git /opt/chiracy
sudo chown -R chiracy:chiracy /opt/chiracy /var/lib/chiracy
```

### 3. 環境変数を設定

```sh
sudo -u chiracy cp /opt/chiracy/.env.example /opt/chiracy/.env
sudoedit /opt/chiracy/.env
sudo chmod 600 /opt/chiracy/.env
sudo install -d -o chiracy -g chiracy /opt/chiracy/data
```

`.env` の `OPENAI_API_KEY` に実際のAPIキーを設定します。`.env` や
`data/chiracy.sqlite` はGitへ追加しないでください。

初回起動時の依存取得を事前に済ませます。

```sh
sudo -u chiracy env DENO_DIR=/var/lib/chiracy/.cache/deno \
  /usr/local/bin/deno cache /opt/chiracy/src/server.ts
```

### 4. systemdユニットを作成

`/etc/systemd/system/chiracy.service` を次の内容で作成します。

```ini
[Unit]
Description=Chiracy web application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chiracy
Group=chiracy
WorkingDirectory=/opt/chiracy
Environment=DENO_DIR=/var/lib/chiracy/.cache/deno
ExecStart=/usr/local/bin/deno task start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/chiracy/data /var/lib/chiracy/.cache/deno

[Install]
WantedBy=multi-user.target
```

ユニットを読み込み、自動起動を有効にします。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now chiracy
sudo systemctl status chiracy
curl -I http://127.0.0.1:8100/
```

ログは次のコマンドで確認できます。

```sh
sudo journalctl -u chiracy -f
```

### 5. NginxとLet's Encryptで公開

事前に、使用するドメイン（以下の例では `chiracy.example.com`）のA/AAAAレコードを
このUbuntuサーバーへ向けてください。8100番は外部へ開放せず、Nginxから
`127.0.0.1:8100` へプロキシします。

```sh
sudo apt install -y nginx certbot python3-certbot-nginx
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

`/etc/nginx/sites-available/chiracy`
を次の内容で作成し、ドメイン名を置き換えます。

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name chiracy.example.com;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:8100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

設定を有効にして、構文を確認してからNginxを再読み込みします。

```sh
sudo ln -s /etc/nginx/sites-available/chiracy /etc/nginx/sites-enabled/chiracy
sudo nginx -t
sudo systemctl reload nginx
```

CertbotでLet's
Encrypt証明書を取得し、HTTPからHTTPSへのリダイレクトを設定します。

```sh
sudo certbot --nginx -d chiracy.example.com --redirect
```

ブラウザーで `https://chiracy.example.com`
を開いて確認します。証明書の自動更新は systemd
timerで行われます。次のコマンドで更新テストとtimerの状態を確認できます。

```sh
sudo certbot renew --dry-run
systemctl list-timers certbot.timer
```

Nginxが設定する `X-Forwarded-Proto`
により、HTTPSアクセス時のセッションCookieには `Secure`
属性が設定され、共有用URLもHTTPSで生成されます。

### 更新

```sh
sudo systemctl stop chiracy
sudo install -d -m 700 /var/backups/chiracy
sudo cp -a /opt/chiracy/data \
  /var/backups/chiracy/data-$(date +%Y%m%d-%H%M%S)
sudo -u chiracy git -C /opt/chiracy pull --ff-only
sudo -u chiracy env DENO_DIR=/var/lib/chiracy/.cache/deno \
  /usr/local/bin/deno cache /opt/chiracy/src/server.ts
sudo systemctl start chiracy
sudo systemctl status chiracy
```

schema migrationはサービス起動時に自動適用されます。上記の例ではサービス停止中に
`data` ディレクトリをコピーするため、SQLite本体とWAL/SHMファイルを一貫して
バックアップできます。

サイト生成と更新にはOpenAI Responses API、画像生成と加工にはOpenAI Image
APIを使用します。コンテンツには画像・PDF・CSV・音声を10MBまでアップロードできます。
一覧のマイコンテンツ画面でURLをコピーし、チャットの指示に貼り付けることでサイトや
アプリから利用できます。アップロード時の付加情報、画像生成時の指示、コンテンツURLは
サイト・アプリ生成AIへ自動的に共有されます。

新規ユーザーには1000ポイントが付与されます。AI利用後に、設定したAPI単価から
`API料金（USD）× USD_JPY_RATE × 2` を円単位で切り上げたポイントを減算します。
API料金は変更されることがあるため、`.env`
の単価と為替レートを適宜更新してください。
