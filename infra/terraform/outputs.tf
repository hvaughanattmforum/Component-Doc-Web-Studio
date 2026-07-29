output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "apprunner_service_arn" {
  value = aws_apprunner_service.app.arn
}

output "apprunner_service_url" {
  description = "Default App Runner URL - use this for the GitHub OAuth callback / ALLOWED_ORIGIN bootstrap step if not using a custom domain."
  value       = "https://${aws_apprunner_service.app.service_url}"
}

output "github_actions_deploy_role_arn" {
  description = "Put this in the repo's Settings -> Secrets and variables -> Actions -> Variables as AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_actions_deploy.arn
}

output "custom_domain_dns_records" {
  description = "DNS records to create if custom_domain was set - see README."
  value       = var.custom_domain != "" ? aws_apprunner_custom_domain_association.app[0].certificate_validation_records : null
}
