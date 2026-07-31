variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
}

variable "app_name" {
  description = "Base name for all resources (ECR repo, ECS Express service, IAM roles)"
  type        = string
  default     = "oda-web-studio"
}

variable "github_owner" {
  description = "GitHub org/user that owns this app's repo (used for the OIDC deploy role's trust policy)"
  type        = string
  default     = "hvaughanattmforum"
}

variable "github_repo" {
  description = "GitHub repo name (used for the OIDC deploy role's trust policy)"
  type        = string
  default     = "Component-Doc-Web-Studio"
}

variable "github_owner_id" {
  description = "GitHub's numeric, immutable ID for github_owner. Required since GitHub's 2026-04-23 'immutable subject claims' change (https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/) - repos created after 2026-07-15 (this one included) send an OIDC sub claim shaped like repo:OWNER@OWNER_ID/REPO@REPO_ID:... instead of the old plain repo:OWNER/REPO:..., so the trust policy has to match that shape or every CI deploy fails with 'Not authorized to perform sts:AssumeRoleWithWebIdentity'. Find via `curl -s https://api.github.com/users/<owner>` -> \"id\"."
  type        = string
}

variable "github_repo_id" {
  description = "GitHub's numeric, immutable ID for github_repo - see github_owner_id above for why this is needed. Find via `curl -s https://api.github.com/repos/<owner>/<repo>` -> \"id\"."
  type        = string
}

variable "spec_repo_url" {
  description = "Git URL of the ODA spec repo each signed-in user gets their own workspace clone of"
  type        = string
  default     = "https://github.com/hvaughanattmforum/WebSpecDemoData.git"
}

variable "spec_repo_branch" {
  description = "Base branch new session branches/PRs are created from"
  type        = string
  default     = "main"
}

variable "github_callback_url" {
  description = "GitHub OAuth callback URL. Leave blank for the first apply (the ECS Express service's own URL isn't known yet) - see README for the two-step bootstrap."
  type        = string
  default     = ""
}

variable "allowed_origin" {
  description = "CORS origin lock. Leave blank for the first apply, same bootstrap ordering as github_callback_url."
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Informational only - not consumed by any resource here. The actual custom domain wiring (ACM cert, ALB listener certificate, host-header listener rule) was done out-of-band via the AWS CLI/console, not Terraform, because it was set up against an ALB that ECS Express Mode provisions internally rather than as a resource this config owns. See custom_domain_listener_rule_arn below for the piece Terraform *does* need to know about."
  type        = string
  default     = ""
}

variable "custom_domain_listener_rule_arn" {
  description = "ARN of the ALB listener rule that routes custom_domain's host-header to whichever of Express Mode's 2 target groups is currently active. Only needed so the GitHub Actions deploy role can be granted elb:ModifyRule on it - see .github/workflows/deploy.yml, which re-points this rule after every deploy (Express Mode blue/green-swaps between its 2 target groups on every deployment, silently breaking this rule if it isn't re-pointed). Leave blank if no custom domain is set up."
  type        = string
  default     = ""
}

variable "alb_listener_arn" {
  description = "ARN of the ECS Express Mode ALB's HTTPS listener (find via `aws elbv2 describe-load-balancers` / `describe-listeners` - the ALB is named ecs-express-gateway-alb-*). Needed by the GitHub Actions deploy role to look up which target group is currently active. Leave blank if no custom domain is set up."
  type        = string
  default     = ""
}
