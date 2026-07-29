# These resources only create the secret containers. Terraform never sets
# their values - real secrets never belong in .tf source or state as
# plaintext. Populate each one out-of-band before the App Runner service can
# start successfully (see README "Bootstrapping" section):
#
#   aws secretsmanager put-secret-value --secret-id oda-web-studio/session-secret --secret-string "$(openssl rand -hex 32)"
#   aws secretsmanager put-secret-value --secret-id oda-web-studio/github-client-id --secret-string "..."
#   aws secretsmanager put-secret-value --secret-id oda-web-studio/github-client-secret --secret-string "..."

resource "aws_secretsmanager_secret" "session_secret" {
  name = "${var.app_name}/session-secret"
}

resource "aws_secretsmanager_secret" "github_client_id" {
  name = "${var.app_name}/github-client-id"
}

resource "aws_secretsmanager_secret" "github_client_secret" {
  name = "${var.app_name}/github-client-secret"
}
