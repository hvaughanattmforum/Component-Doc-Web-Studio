# ECS Express Mode deployment (Terraform)

Provisions: an ECR repo, a single-task Amazon ECS Express Mode service (see
`ecs-express.tf` for why it's pinned to 1 task - the app keeps sessions in
memory and per-user workspace clones on local disk), the three Secrets
Manager containers the app needs, and a GitHub Actions OIDC deploy role (no
static AWS keys stored in the repo).

This replaces an earlier AWS App Runner scaffold (see git history:
`apprunner.tf`) - AWS closed App Runner to new customers on 2026-04-30
(https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html),
and this account had never created an App Runner service before, so every
deployment attempt silently failed. ECS Express Mode is AWS's own
recommended replacement, and (per its own design) needs far less manual
bootstrapping than App Runner did - one resource provisions the Fargate
service, ALB, auto scaling and networking.

State is local (`terraform.tfstate` in this directory, gitignored) for a
first launch. If more than one person will run `terraform apply` against
this, move to a remote backend (S3 + DynamoDB lock table) before that
happens - two people applying from local state will clobber each other.

## Prerequisites

- Terraform >= 1.5, Docker, credentials for an AWS account/region you
  control.
- A GitHub OAuth App - see the main [README.md](../../README.md#github-oauth-app)
  for how to register one. You'll come back to update its callback URL once
  the ECS Express service's URL is known (step 3 below).

## Bootstrapping

Unlike App Runner, there's no strict ordering requirement here - Terraform
figures out the dependency graph itself (secret containers and the ECR repo
before the service that references them). The one real prerequisite is an
image in ECR for the service to pull on creation.

1. **Build and push an initial image**, and populate the 3 secrets (values
   never live in Terraform):

   ```bash
   aws ecr get-login-password --region <region> | \
     docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
   docker build --provenance=false --sbom=false -t <account-id>.dkr.ecr.<region>.amazonaws.com/oda-web-studio:latest ..
   docker push <account-id>.dkr.ecr.<region>.amazonaws.com/oda-web-studio:latest

   aws secretsmanager put-secret-value --secret-id oda-web-studio/session-secret \
     --secret-string "$(openssl rand -hex 32)"
   aws secretsmanager put-secret-value --secret-id oda-web-studio/github-client-id \
     --secret-string "<GitHub OAuth App client ID>"
   aws secretsmanager put-secret-value --secret-id oda-web-studio/github-client-secret \
     --secret-string "<GitHub OAuth App client secret>"
   ```

   (`--provenance=false --sbom=false` avoids BuildKit's default attestation
   manifest, which some AWS services have had compatibility issues with -
   harmless to keep even if not strictly required on ECS.)

2. **Apply everything:**

   ```bash
   terraform init
   terraform apply
   ```

   Note `ecs_service_url` from the output.

3. **Close the loop**: update the GitHub OAuth App's callback URL to
   `<ecs_service_url>auth/github/callback`, then set `github_callback_url`
   and `allowed_origin` in `terraform.tfvars` to match, and `terraform apply`
   again to push those env vars to the running service.

4. **Wire up GitHub Actions** - in the repo's Settings -> Secrets and
   variables -> Actions -> Variables, add:
   - `AWS_REGION` - the region you deployed into
   - `ECR_REPOSITORY` - `oda-web-studio` (or your `app_name`)
   - `ECS_SERVICE` / `ECS_CLUSTER` - from the `ecs_service_arn` output
   - `AWS_DEPLOY_ROLE_ARN` - the `github_actions_deploy_role_arn` output

   From then on, a push to `main` (or manual dispatch) builds, pushes to
   ECR, and redeploys the ECS Express service - see
   [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

## Variables

See [`variables.tf`](variables.tf) for the full list and defaults. At minimum
create a `terraform.tfvars` with:

```hcl
aws_region = "us-east-1"
```

## Custom domain

Not wired up yet - ECS Express Mode custom domains go through the ALB's
listener plus an ACM certificate rather than the App Runner-style
association this scaffold used to have. See AWS's migration guide
(link above) for the steps if this is needed later.
