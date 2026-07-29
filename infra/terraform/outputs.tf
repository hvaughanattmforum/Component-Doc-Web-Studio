output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "ecs_service_arn" {
  value = module.express_service.service_arn
}

output "ecs_service_url" {
  # NOT module.express_service.service_url - that output guesses
  # "https://<service_name>.ecs.<region>.on.aws/", but the real endpoint is
  # a randomized subdomain assigned by Express Mode itself, only known via
  # ingress_paths after creation.
  description = "Default ECS Express Mode URL - use this for the GitHub OAuth callback / ALLOWED_ORIGIN bootstrap step (custom domains aren't wired up yet - see AWS's migration guide for adding one via the ALB)."
  value       = module.express_service.ingress_paths[0].endpoint
}

output "github_actions_deploy_role_arn" {
  description = "Put this in the repo's Settings -> Secrets and variables -> Actions -> Variables as AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_actions_deploy.arn
}
