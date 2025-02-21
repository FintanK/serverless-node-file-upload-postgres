const { Client } = require('pg');
const formidable = require('formidable');
const AWS = require('aws-sdk');
const fs = require('fs');

// Database connection details
const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;

const dbConfig = {
    host: PGHOST || 'localhost',
    user: PGUSER || 'postgres',
    password: PGPASSWORD || 'password',
    database: PGDATABASE || 'mydb',
    port: PGPORT || 5432,
};

// S3 Configuration
const s3 = new AWS.S3({});
const BUCKET_NAME = 'uploads-s3-bucket';

/**
 * @swagger
 * /upload:
 *   post:
 *     summary: Upload a file
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         description: The file to upload
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: File uploaded successfully
 *                 upload:
 *                   type: object
 *                   properties:
 *                     filename:
 *                       type: string
 *                       example: example.jpg
 *                     filepath:
 *                       type: string
 *                       example: https://uploads-s3-bucket.s3.amazonaws.com/example.jpg
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: No file uploaded
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: File upload to S3 failed
 */
module.exports.main = async (event) => {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        if (event.httpMethod === 'POST' && event.path === '/upload') {
            const form = new formidable.IncomingForm();

            return new Promise((resolve, reject) => {
                form.parse(event, async (err, fields, files) => {
                    if (err) {
                        reject({ statusCode: 500, body: JSON.stringify({ error: 'File upload failed' }) });
                        return;
                    }

                    const file = files.file;
                    if (!file) {
                        reject({ statusCode: 400, body: JSON.stringify({ error: 'No file uploaded' }) });
                        return;
                    }

                    const { filepath, originalFilename } = file;

                    try {
                        await s3.upload({
                            Bucket: BUCKET_NAME,
                            Key: originalFilename,
                            Body: fs.createReadStream(filepath),
                        }).promise();
                    } catch (s3Err) {
                        console.error("S3 upload error:", s3Err);
                        reject({ statusCode: 500, body: JSON.stringify({ error: 'File upload to S3 failed' }) });
                        return;
                    }

                    const fileUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${originalFilename}`;

                    const query = 'INSERT INTO uploads (filename, filepath) VALUES ($1, $2) RETURNING *';
                    const result = await client.query(query, [originalFilename, fileUrl]);

                    resolve({
                        statusCode: 200,
                        body: JSON.stringify({ message: 'File uploaded successfully', upload: result.rows[0] }),
                    });
                });
            });
        } else {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'Route not found' }),
            };
        }
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' }),
        };
    } finally {
        await client.end();
    }
};


// swagger.js (Swagger definition file)
const swaggerJSDoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'File Upload API',
            version: '1.0.0',
            description: 'API for uploading files',
        },
    },
    apis: ['handler.js'], // Path to your Lambda function file
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;



// server.js (Example Express server for local development and Swagger UI)
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const handler = require('./handler'); // Import your Lambda handler

const app = express();
const port = 3000;

app.use(express.json()); // Important for parsing JSON requests (if needed)


// Mock Lambda event and context for local testing
app.post('/upload', (req, res) => {
    const event = {
        httpMethod: 'POST',
        path: '/upload',
        // Important: For local testing, you'll likely need middleware to handle multipart/form-data
        // like 'multer' or 'busboy' and populate the 'body' property of the event
        // to mimic what API Gateway would provide.  Formidable works differently
        // in a local context.
        body: req, // or req.body if you use body-parser
        isOffline: true, // helpful for local testing
    };

    handler.main(event, {}, (err, response) => {
        if (err) {
            console.error(err);
            res.status(500).send(err);
        } else {
            res.status(response.statusCode).send(response.body);
        }
    });
});


app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});