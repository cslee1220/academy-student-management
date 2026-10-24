# EC2 단독 배포 파일

이 디렉터리는 서울 리전의 EC2 인스턴스 한 대에서 Docker로 Next.js standalone 서버를 실행하기 위한 템플릿이다.

AWS 리소스를 생성하거나 조회하지 않으며, Route 53·S3·CloudFront·RDS·Lambda·ECS·ECR·ALB·ACM·Secrets Manager·CloudWatch를 사용하지 않는다.

## 구성

- `academy-student-management.service`: Docker 컨테이너를 `127.0.0.1:8080`으로 실행하는 systemd unit
- `nginx.conf.template`: EC2 내부 Nginx가 `80`을 받아 앱으로 전달하는 설정

## EC2 준비값

다음 값을 실제 배포 전에 확정한다.

- EC2 instance ID
- AMI와 운영체제
- 인스턴스 유형
- 보안 그룹 ID
- SSH 허용 관리자 IP
- 공인 IP 또는 Elastic IP
- 외부 DNS 도메인 사용 여부
- `APP_BASE_URL`

값을 임의로 채우지 않는다.

## 비밀값 파일

EC2에서 root만 읽을 수 있는 파일을 만든다. 실제 값은 채팅·Git·이미지·명령행에 넣지 않는다.

```bash
sudo install -d -m 700 /etc/academy-student-management
sudo install -m 600 /dev/null /etc/academy-student-management/app.env
sudoedit /etc/academy-student-management/app.env
```

파일에는 운영 환경에서 필요한 다음 변수만 넣는다.

```dotenv
NODE_ENV=production
PORT=8080
HOSTNAME=0.0.0.0
NEXT_PUBLIC_SUPABASE_URL=<supabase-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-secret>
APP_BASE_URL=<confirmed-app-base-url>
```

`SUPABASE_SERVICE_ROLE_KEY`는 브라우저 공개 변수로 사용하지 않는다.

## 이미지 전송과 실행 예시

ECR·S3를 사용하지 않고 승인된 SSH/SCP 경로로 이미지 tar 파일을 전송한다.

```bash
# 로컬에서 실행
docker build -t academy-student-management:current ./web
docker save academy-student-management:current -o academy-student-management.tar
scp academy-student-management.tar <ec2-user>@<ec2-host>:/tmp/

# EC2에서 실행
docker load -i /tmp/academy-student-management.tar
sudo install -d -m 755 /opt/academy-student-management
sudo install -m 644 academy-student-management.service /etc/systemd/system/academy-student-management.service
sudo systemctl daemon-reload
sudo systemctl enable --now academy-student-management.service
```

실제 사용자명·호스트·경로는 EC2 운영체제와 확정된 값에 맞춰 검토한다. 예시 명령을 그대로 실행하지 않는다.

## Nginx 설치와 health 확인

운영체제에 맞는 패키지 관리자와 Nginx 설정 디렉터리를 확인한 뒤 템플릿의 `__REQUIRED_SERVER_NAME__`을 확정된 IP 또는 외부 DNS 이름으로 교체한다.

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail http://127.0.0.1/api/health
sudo journalctl -u academy-student-management.service -n 100 --no-pager
```

애플리케이션 포트 `8080`은 보안 그룹에서 외부에 직접 열지 않는다. SSH `22`는 관리자 허용 IP에만 열고, Nginx를 사용할 때만 `80` 또는 `443`을 연다.

## 롤백

이전 정상 이미지 tag 또는 tar 파일을 보존한 뒤 다음 순서로 되돌린다.

```bash
docker tag <previous-image> academy-student-management:current
sudo systemctl restart academy-student-management.service
curl --fail http://127.0.0.1/api/health
```

운영 DB에 seed나 reset을 실행하지 않는다.
