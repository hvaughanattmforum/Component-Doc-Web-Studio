# App Runner deployment (Terraform)

Provisions: an ECR repo, a single-instance App Runner service (see
`apprunner.tf` for why it's pinned to 1 instance), the three Secrets Manager
containers the app needs, and a GitHub Actions OIDC deploy role (no static
AWS keys stored in the repo).

State is local (`terraform.tfstate` in this directory, gitignored) for a
first launch. If more than one person will run `terraform apply` against
this, move to a remote backend (S3 + DynamoDB lock table) before that
happens - two people applying from local state will clobber each other.

## Prerequisites

- Terraform >= 1.5, AWS CLI, Docker, credentials for an AWS account/region you
  control.
- A GitHub OAuth App - see the main [README.md](../../README.md#github-oauth-app)
  for how to register one. You'll come back to update its callback URL once
  the App Runner URL is known (step 4 below).

## Bootstrapping (order matters - there's a real chicken-and-egg here)

App Runner needs an image in ECR before the service can be created, and the
service's own URL isn't known until after it's created - so this is a few
distinct passes, not one `apply`.

1. **Create the ECR repo and IAM roles only:**

   ```bash
   terraform init
   terraform apply -target=aws_ecr_repository.app -target=aws_ecr_lifecycle_policy.app \
     -target=aws_iam_role.apprunner_instance -target=aws_iam_role_policy.apprunner_instance_secrets \
     -target=aws_iam_role.apprunner_access -target=aws_iam_role_policy_attachment.apprunner_access_ecr \
     -target=aws_secretsmanager_secret.session_secret -target=aws_secretsmanager_secret.github_client_id \
     -target=aws_secretsmanager_secret.github_client_secret
   ```

2. **Populate the secrets** (values never live in Terraform):

   ```bash
   aws secretsmanager put-secret-value --secret-id oda-web-studio/session-secret \
     --secret-string "$(openssl rand -hex 32)"
   aws secretsmanager put-secret-value --secret-id oda-web-studio/github-client-id \
     --secret-string "<GitHub OAuth App client ID>"
   aws secretsmanager put-secret-value --secret-id oda-web-studio/github-client-secret \
     --secret-string "<GitHub OAuth App client secret>"
   ```

3. **Build and push an initial image** so the App Runner service has something
   to pull on creation:

   ```bash
   aws ecr get-login-password --region <region> | \
     docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
   docker build -t <account-id>.dkr.ecr.<region>.amazonaws.com/oda-web-studio:latest ..
   docker push <account-id>.dkr.ecr.<region>.amazonaws.com/oda-web-studio:latest
   ```

4. **Apply everything else** (the App Runner service, auto-scaling config,
   GitHub OIDC deploy role):

   ```bash
   terraform apply
   ```

   Note `apprunner_service_url` from the output.

5. **Close the loop**: update the GitHub OAuth App's callback URL to
   `https://<apprunner_service_url>/auth/github/callback` (or your
   `custom_domain` if set), then set `github_callback_url` and
   `allowed_origin` in `terraform.tfvars` to match, and `terraform apply`
   again to push those env vars to the running service.

6. **Wire up GitHub Actions** - in the repo's Settings -> Secrets and
   variables -> Actions -> Variables, add:
   - `AWS_REGION` - the region you deployed into
   - `ECR_REPOSITORY` - `oda-web-studio` (or your `app_name`)
   - `APP_RUNNER_SERVICE_ARN` - the `apprunner_service_arn` output
   - `AWS_DEPLOY_ROLE_ARN` - the `github_actions_deploy_role_arn` output

   From then on, a push to `main` (or manual dispatch) builds, pushes to
   ECR, and triggers an App Runner deployment - see
   [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

## Variables

See [`variables.tf`](variables.tf) for the full list and defaults. At minimum
create a `terraform.tfvars` with:

```hcl
aws_region = "eu-west-2"
```

## Custom domain (optional)

Set `custom_domain` and re-apply; `custom_domain_dns_records` in the output
gives the CNAME records to create for App Runner's certificate validation
and traffic routing (Route 53 or wherever the domain's DNS is hosted).
