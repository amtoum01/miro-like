from setuptools import setup, find_packages

setup(
    name="whiteboard-backend",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "fastapi",
        "uvicorn",
        "sqlalchemy",
        "python-jose[cryptography]",
        "passlib[bcrypt]",
        "python-multipart",
        "websockets",
        "python-dotenv",
        "pydantic",
        "psycopg2-binary",
        "gunicorn",
    ],
) 