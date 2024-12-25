from setuptools import setup, find_packages

setup(
    name="whiteboard-backend",
    version="0.1.0",
    packages=find_packages(),
    python_requires=">=3.11",
    install_requires=[
        "fastapi>=0.104.1",
        "uvicorn>=0.24.0",
        "sqlalchemy>=2.0.23",
        "python-jose[cryptography]>=3.3.0",
        "passlib[bcrypt]>=1.7.4",
        "python-multipart>=0.0.6",
        "websockets>=12.0",
        "python-dotenv>=1.0.0",
        "pydantic>=2.5.2",
        "psycopg2-binary>=2.9.9",
        "gunicorn>=21.2.0",
    ],
    author="Your Name",
    description="A collaborative whiteboard backend",
    classifiers=[
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.11",
    ],
) 