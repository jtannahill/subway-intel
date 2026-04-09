import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { DatabaseStack } from '../lib/database-stack'
import { FargateStack } from '../lib/fargate-stack'
import { FrontendStack } from '../lib/frontend-stack'

const app = new cdk.App()
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }

const db = new DatabaseStack(app, 'SubwayIntelDB', { env })
const fargate = new FargateStack(app, 'SubwayIntelFargate', { env, dbInstance: db.instance, vpc: db.vpc })
new FrontendStack(app, 'SubwayIntelFrontend', { env })
